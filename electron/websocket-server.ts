import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import https from 'https';
import type { IncomingMessage } from 'http';

export interface WebSocketServerOptions {
  port?: number;
  host?: string;
  maxPayload?: number; // 5MB default
  sessionToken?: string; // Reuse a persisted token; a random one is generated otherwise
  // Self-signed TLS cert: without it an https:// sender page (e.g. deployed on the web)
  // cannot open a connection here at all — browsers block ws:// as mixed content from https://.
  tls: { key: string; cert: string };
  onTextReceived?: (text: string, metadata: { timestamp: number; senderId: string }) => void;
  onImagesReceived?: (images: string[]) => void;
  onSenderStatusChange?: (connected: boolean, senderInfo?: { id: string }) => void;
  onError?: (err: Error) => void;
}

const MAX_IMAGES = 10;

export class LocalCompanionWebSocketServer {
  private wss: WebSocketServer | null = null;
  private httpServer: https.Server | null = null;
  private sessionToken: string;
  private activeSenderWs: WebSocket | null = null;
  private activeSenderId: string | null = null;
  private lastReply = '';
  private lastReplyImage = '';
  private port: number;
  private host: string;
  private options: WebSocketServerOptions;

  constructor(options: WebSocketServerOptions) {
    this.port = options.port || 8765;
    this.host = options.host || '127.0.0.1'; // Strictly localhost per spec #12
    this.options = {
      maxPayload: 5 * 1024 * 1024, // 5MB limit per spec #22
      ...options,
    };
    this.sessionToken = options.sessionToken || crypto.randomBytes(16).toString('hex');
  }

  public getSessionToken(): string {
    return this.sessionToken;
  }

  public regenerateSessionToken(): string {
    return this.applyNewSessionToken(crypto.randomBytes(16).toString('hex'));
  }

  // Lets the user set their own token instead of the random default (e.g. to share something memorable)
  public setSessionToken(token: string): string {
    return this.applyNewSessionToken(token);
  }

  private applyNewSessionToken(token: string): string {
    this.sessionToken = token;
    this.broadcast({
      type: 'TOKEN_REFRESHED',
      message: 'Session token has been rotated. Please re-authenticate.',
    });
    // Drop every existing connection so senders holding the old token lose access
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close(4001, 'Session token rotated');
      }
    }
    return this.sessionToken;
  }

  // Text typed in the companion's reply box, shown on the active sender's web page
  // source: 'typing' (reply box keystrokes), 'clipboard' (auto-send) or 'send' (Send button).
  // The web page only asks Gemini about 'clipboard' and 'send' replies.
  public sendReply(text: string, source = 'typing'): boolean {
    this.lastReply = text;
    // Only the newest item is kept for reconnects (matches the web page)
    if (text) this.lastReplyImage = '';
    const ws = this.activeSenderWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'REPLY_UPDATE', text, source, timestamp: Date.now() }));
    return true;
  }

  // Text copied on the desktop (clipboard auto-send): shown on the web page as "Copied text", not as a reply
  public sendCopiedText(text: string): boolean {
    const ws = this.activeSenderWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'COPIED_TEXT', text, timestamp: Date.now() }));
    return true;
  }

  // Screenshot taken in the desktop app, shown on the active sender's web page
  public sendReplyImage(image: string): boolean {
    this.lastReplyImage = image;
    this.lastReply = '';
    const ws = this.activeSenderWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'REPLY_IMAGE', image, timestamp: Date.now() }));
    return true;
  }

  public isSenderConnected(): boolean {
    return this.activeSenderWs !== null && this.activeSenderWs.readyState === WebSocket.OPEN;
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        this.httpServer = https.createServer({ key: this.options.tls.key, cert: this.options.tls.cert }, (req, res) => {
          // Provide health check / token validation endpoint for local apps
          if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'running',
                senderConnected: this.isSenderConnected(),
                port: this.port,
              })
            );
            return;
          }
          res.writeHead(404);
          res.end();
        });

        this.wss = new WebSocketServer({
          server: this.httpServer,
          maxPayload: this.options.maxPayload,
        });

        this.wss.on('connection', (ws: WebSocket, req) => {
          this.handleClientConnection(ws, req);
        });

        this.wss.on('error', (err: any) => {
          if (this.options.onError) {
            this.options.onError(err);
          }
          reject(err);
        });

        this.httpServer.listen(this.port, this.host, () => {
          console.log(`[Local WebSocket Server] Listening on ${this.host}:${this.port}`);
          console.log(`[Local WebSocket Server] Session Token: ${this.sessionToken}`);
          resolve(this.port);
        });
      } catch (err: any) {
        reject(err);
      }
    });
  }

  private handleClientConnection(ws: WebSocket, req: IncomingMessage) {
    const clientId = crypto.randomUUID();
    let isAuthenticated = false;

    // Spec #11: Only one sender active by default. Only called once the client has authenticated.
    const assignOrWarn = () => {
      if (this.activeSenderWs === null || this.activeSenderWs.readyState !== WebSocket.OPEN) {
        this.activeSenderWs = ws;
        this.activeSenderId = clientId;
        ws.send(
          JSON.stringify({
            type: 'SENDER_ASSIGNED',
            isActive: true,
            message: 'Connected to Desktop Companion service.',
          })
        );
        this.pushLastReply(ws);
        if (this.options.onSenderStatusChange) {
          this.options.onSenderStatusChange(true, { id: clientId });
        }
      } else {
        ws.send(
          JSON.stringify({
            type: 'WARNING_MULTIPLE_SENDERS',
            isActive: false,
            message: 'Another browser session is connected.',
          })
        );
      }
    };

    const markAuthenticated = () => {
      if (isAuthenticated) {
        ws.send(JSON.stringify({ type: 'AUTH_SUCCESS' }));
        return;
      }
      isAuthenticated = true;
      ws.send(JSON.stringify({ type: 'AUTH_SUCCESS' }));
      assignOrWarn();
    };

    // Optional query parameter authentication
    const url = new URL(req.url || '', `https://${this.host}:${this.port}`);
    const tokenQuery = url.searchParams.get('token');
    if (tokenQuery && tokenQuery === this.sessionToken) {
      markAuthenticated();
    }

    ws.on('message', (data: Buffer | string) => {
      try {
        const raw = data.toString();
        let parsed: any;
        try {
          parsed = JSON.parse(raw);
        } catch {
          ws.send(
            JSON.stringify({
              type: 'ERROR',
              code: 'INVALID_JSON',
              message: 'Invalid message received.',
            })
          );
          return;
        }

        if (!parsed || typeof parsed !== 'object' || !parsed.type) {
          ws.send(
            JSON.stringify({
              type: 'ERROR',
              code: 'MALFORMED',
              message: 'Invalid message format.',
            })
          );
          return;
        }

        // Keep-alive PING / PONG per spec #4
        if (parsed.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
          return;
        }

        // Authentication handshake
        if (parsed.type === 'AUTH') {
          if (typeof parsed.token === 'string' && parsed.token === this.sessionToken) {
            markAuthenticated();
          } else {
            ws.send(
              JSON.stringify({
                type: 'AUTH_FAILED',
                message: 'Invalid session token.',
              })
            );
          }
          return;
        }

        // Everything below requires a valid session token (the service is reachable over the LAN)
        if (!isAuthenticated) {
          ws.send(
            JSON.stringify({
              type: 'AUTH_FAILED',
              message: 'Session token required. Enter the token shown in the Desktop Companion window.',
            })
          );
          return;
        }

        // Graceful role takeover: the sender the user is typing in becomes the active one
        if (parsed.type === 'CLAIM_ACTIVE_SENDER') {
          const previous = this.activeSenderWs;
          this.activeSenderWs = ws;
          this.activeSenderId = clientId;
          if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) {
            previous.send(
              JSON.stringify({
                type: 'WARNING_MULTIPLE_SENDERS',
                isActive: false,
                message: 'Another browser session took over as the active sender.',
              })
            );
          }
          ws.send(
            JSON.stringify({
              type: 'SENDER_ASSIGNED',
              isActive: true,
              message: 'Connected to Desktop Companion service.',
            })
          );
          this.pushLastReply(ws);
          if (this.options.onSenderStatusChange) {
            this.options.onSenderStatusChange(true, { id: clientId });
          }
          return;
        }

        // Web page pressed Clear: forget the reply and screenshot so they are not re-sent on reconnect
        if (parsed.type === 'CLEAR_REPLY') {
          this.lastReply = '';
          this.lastReplyImage = '';
          return;
        }

        // Pasted images: sent separately from text so they are not re-sent on every keystroke
        if (parsed.type === 'IMAGES_UPDATE') {
          if (this.activeSenderWs !== ws) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Only the active sender may send images.' }));
            return;
          }
          // Untrusted input: accept only base64 raster images (no SVG, which can carry script)
          const images = Array.isArray(parsed.images)
            ? parsed.images
                .filter(
                  (img: unknown): img is string =>
                    typeof img === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(img)
                )
                .slice(0, MAX_IMAGES)
            : [];
          if (this.options.onImagesReceived) {
            this.options.onImagesReceived(images);
          }
          ws.send(JSON.stringify({ type: 'ACK', timestamp: Date.now(), imageCount: images.length }));
          return;
        }

        // Text Update per spec #4 & #7
        if (parsed.type === 'TEXT_UPDATE') {
          if (this.activeSenderWs !== ws) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: 'Only the active sender may synchronize text.',
              })
            );
            return;
          }

          // Untrusted plain text processing - ensure string type
          const incomingText = typeof parsed.text === 'string' ? parsed.text : '';

          if (this.options.onTextReceived) {
            this.options.onTextReceived(incomingText, {
              timestamp: Date.now(),
              senderId: clientId,
            });
          }

          ws.send(
            JSON.stringify({
              type: 'ACK',
              timestamp: Date.now(),
              charCount: incomingText.length,
            })
          );
        }
      } catch (err: any) {
        console.error('WebSocket message handling error:', err);
      }
    });

    ws.on('close', () => {
      if (this.activeSenderWs === ws) {
        this.activeSenderWs = null;
        this.activeSenderId = null;
        if (this.options.onSenderStatusChange) {
          this.options.onSenderStatusChange(false);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('Client WebSocket socket error:', err);
    });
  }

  private pushLastReply(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (this.lastReply) {
      ws.send(JSON.stringify({ type: 'REPLY_UPDATE', text: this.lastReply, timestamp: Date.now() }));
    }
    if (this.lastReplyImage) {
      ws.send(JSON.stringify({ type: 'REPLY_IMAGE', image: this.lastReplyImage, timestamp: Date.now() }));
    }
  }

  private broadcast(payload: any) {
    if (!this.wss) return;
    const msg = JSON.stringify(payload);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          if (this.httpServer) {
            this.httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}
