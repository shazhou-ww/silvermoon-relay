import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import {
  getWSConnectionHandler,
  type WSConnectionHandlerOptions,
  type WSSHandlerOptions,
} from "@trpc/server/adapters/ws";
import type { AnyRouter } from "@trpc/server";
import type NodeWebSocket from "ws";

class CloudflareWebSocketBridge extends EventEmitter {
  constructor(private readonly socket: WebSocket) {
    super();
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  send(data: string | Uint8Array): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(
      typeof data === "string" ? data : data.slice().buffer,
    );
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }

  terminate(): void {
    this.socket.close(1011, "tRPC WebSocket terminated");
  }
}

export function acceptTRPCWebSocket<TRouter extends AnyRouter>(
  request: Request,
  socket: WebSocket,
  options: WSConnectionHandlerOptions<TRouter>,
): void {
  const bridge = new CloudflareWebSocketBridge(socket);
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      bridge.emit("message", Buffer.from(event.data, "utf8"), false);
      return;
    }
    bridge.emit("message", Buffer.from(event.data), true);
  });
  socket.addEventListener("close", (event) => {
    bridge.emit("close", event.code, Buffer.from(event.reason));
  });
  socket.addEventListener("error", () => {
    bridge.emit("error", new Error("Cloudflare WebSocket error."));
  });
  socket.accept();

  const handler = getWSConnectionHandler({
    ...options,
    wss: {} as WSSHandlerOptions<TRouter>["wss"],
  } as WSSHandlerOptions<TRouter>);
  const nodeRequest = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers),
  } as IncomingMessage;
  handler(
    bridge as unknown as NodeWebSocket,
    nodeRequest,
  );
}
