import pkg from "../../package.json";

/** "publisher.name" from package.json: the single source for vscode:// links and walkthrough ids. */
export const EXT_ID = `${pkg.publisher}.${pkg.name}`;
export const openUri = (folder?: string): string => `vscode://${EXT_ID}/open${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`;
