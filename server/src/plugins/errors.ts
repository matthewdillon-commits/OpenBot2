export class PluginRefusedError extends Error {
  constructor(
    message: string,
    readonly rule: string | null,
  ) {
    super(message);
    this.name = "PluginRefusedError";
  }
}

/** Policy permitted an MCP write; it waits as an approval card on the goal. */
export class PluginWaitingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginWaitingError";
  }
}

export class CatalogueEntryUnknownError extends Error {
  constructor(key: string) {
    super(`${key} is not a server this deployment will connect to.`);
    this.name = "CatalogueEntryUnknownError";
  }
}

/** A URL an administrator offered that this deployment will not point itself at. */
export class CustomServerRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomServerRefusedError";
  }
}
