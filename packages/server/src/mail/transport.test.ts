import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type SmtpOptions, SmtpTimeoutError, SmtpTransport } from "./transport.js";

const message = { to: "to@example.org", subject: "Test", text: "Test", html: "<p>Test</p>" };

const servers: Server[] = [];
const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
});

async function listen(onConnection: (socket: Socket) => void): Promise<number> {
  const server = createServer((socket) => {
    sockets.push(socket);
    onConnection(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

function options(port: number): SmtpOptions {
  return {
    host: "127.0.0.1",
    port,
    security: "none",
    username: null,
    password: null,
    from: "wiki@example.org",
  };
}

describe("SMTP time limits", () => {
  it("fails with a greeting timeout when the server accepts the connection and never speaks", async () => {
    const port = await listen(() => undefined);
    const error = await new SmtpTransport(options(port), { greetingMs: 150 }).send(message).catch((e) => e);
    expect(error).toBeInstanceOf(SmtpTimeoutError);
    expect(error.code).toBe("SMTP_GREETING_TIMEOUT");
  });

  it("fails with a send timeout when the server stops answering after the greeting", async () => {
    const port = await listen((socket) => {
      socket.write("220 slow.example.org ESMTP\r\n");
    });
    const error = await new SmtpTransport(options(port), { idleMs: 150 }).send(message).catch((e) => e);
    expect(error).toBeInstanceOf(SmtpTimeoutError);
    expect(error.code).toBe("SMTP_SEND_TIMEOUT");
  });

  it("ends a server that keeps answering slowly at the overall limit", async () => {
    const port = await listen((socket) => {
      socket.write("220 slow.example.org ESMTP\r\n");
      socket.on("data", () => {
        setTimeout(() => socket.write("250 ok\r\n"), 100);
      });
    });
    const started = Date.now();
    const error = await new SmtpTransport(options(port), { sendMs: 300 }).send(message).catch((e) => e);
    expect(error.code).toBe("SMTP_SEND_TIMEOUT");
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
