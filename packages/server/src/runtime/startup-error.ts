/** The process refuses to start; the message tells the administrator what to do. */
export class StartupError extends Error {
  override name = "StartupError";
}
