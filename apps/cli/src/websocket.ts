import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { isVibeSVGProject } from "@vibesvg/ast";
import type { ProjectStore } from "./project-store.js";

const webSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

type HostClient = {
  buffer: Buffer;
  socket: Socket;
};

type ProjectUpdateMessage = {
  type: "project:update";
  project: unknown;
};

type SelectionUpdateMessage = {
  type: "selection:update";
  nodeIds: unknown[];
};

export class WebSocketHub {
  private clients = new Set<HostClient>();
  private unsubscribeStore: () => void;

  constructor(private readonly store: ProjectStore) {
    this.unsubscribeStore = store.subscribe((change) => {
      this.broadcast({
        type: "project:snapshot",
        project: change.project,
        revision: change.revision
      }, change.source);
    });
  }

  close(): void {
    this.unsubscribeStore();

    for (const client of this.clients) {
      client.socket.destroy();
    }

    this.clients.clear();
  }

  handleUpgrade(request: IncomingMessage, socket: Socket): void {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"];

    if (typeof key !== "string") {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(`${key}${webSocketGuid}`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        ""
      ].join("\r\n") + "\r\n"
    );

    const client: HostClient = {
      buffer: Buffer.alloc(0),
      socket
    };

    this.clients.add(client);
    this.sendJson(socket, {
      type: "project:snapshot",
      project: this.store.readProject(),
      revision: this.store.revision()
    });

    socket.on("data", (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk as Buffer]);
      client.buffer = readWebSocketFrames(client.buffer, (message) => {
        this.handleMessage(client, message);
      }, socket);
    });

    socket.on("close", () => {
      this.clients.delete(client);
    });

    socket.on("error", () => {
      this.clients.delete(client);
    });
  }

  private handleMessage(client: HostClient, message: string): void {
    let payload: unknown;

    try {
      payload = JSON.parse(message);
    } catch {
      this.sendJson(client.socket, { type: "error", error: "Invalid JSON message." });
      return;
    }

    if (isProjectUpdateMessage(payload) && isVibeSVGProject(payload.project)) {
      this.store.writeProject(payload.project, client);
      this.sendJson(client.socket, { type: "project:ack", revision: this.store.revision() });
      return;
    }

    if (isSelectionUpdateMessage(payload)) {
      this.store.setSelection({ nodeIds: payload.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string") });
      this.sendJson(client.socket, { type: "selection:ack" });
      return;
    }

    this.sendJson(client.socket, { type: "error", error: "Unsupported host message." });
  }

  private broadcast(payload: unknown, exceptSource?: unknown): void {
    for (const client of this.clients) {
      if (client === exceptSource) {
        continue;
      }

      this.sendJson(client.socket, payload);
    }
  }

  private sendJson(socket: Socket, payload: unknown): void {
    sendWebSocketFrame(socket, Buffer.from(JSON.stringify(payload), "utf8"), 1);
  }
}

function isProjectUpdateMessage(value: unknown): value is ProjectUpdateMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      value.type === "project:update" &&
      "project" in value
  );
}

function isSelectionUpdateMessage(value: unknown): value is SelectionUpdateMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      value.type === "selection:update" &&
      "nodeIds" in value &&
      Array.isArray(value.nodeIds)
  );
}

function readWebSocketFrames(buffer: Buffer, onTextMessage: (message: string) => void, socket: Socket): Buffer {
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const firstByte = buffer[offset]!;
    const secondByte = buffer[offset + 1]!;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (buffer.length - offset < 4) {
        break;
      }

      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) {
        break;
      }

      const largePayloadLength = buffer.readBigUInt64BE(offset + 2);

      if (largePayloadLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        socket.destroy();
        return Buffer.alloc(0);
      }

      payloadLength = Number(largePayloadLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;

    if (buffer.length - offset < frameLength) {
      break;
    }

    const maskOffset = offset + headerLength;
    const payloadOffset = maskOffset + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadOffset, payloadOffset + payloadLength));

    if (masked) {
      const mask = buffer.subarray(maskOffset, maskOffset + 4);

      for (let index = 0; index < payload.length; index += 1) {
        payload[index] = payload[index]! ^ mask[index % 4]!;
      }
    }

    if (opcode === 1) {
      onTextMessage(payload.toString("utf8"));
    } else if (opcode === 8) {
      socket.end();
      return Buffer.alloc(0);
    } else if (opcode === 9) {
      sendWebSocketFrame(socket, payload, 10);
    }

    offset += frameLength;
  }

  return buffer.subarray(offset);
}

function sendWebSocketFrame(socket: Socket, payload: Buffer, opcode: number): void {
  const payloadLength = payload.length;
  let header: Buffer;

  if (payloadLength < 126) {
    header = Buffer.from([0x80 | opcode, payloadLength]);
  } else if (payloadLength <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payloadLength, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payloadLength), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}
