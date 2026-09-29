/** The fields of runtime.MessageSender we check. */
export type SenderLike = { id?: string | undefined; url?: string | undefined };

/**
 * Only this extension's own pages (popup, onboarding, options, and later the block page) may send
 * commands. Web pages can't reach us at all (no externally_connectable), and there are no content
 * scripts; if one is added, its messages arrive with the page's URL and are refused here.
 *
 * `extensionBase` is runtime.getURL(""), e.g. "chrome-extension://<id>/". We compare by prefix, not
 * URL.origin: for non-special schemes such as moz-extension:// some engines report origin "null",
 * which would make every such URL look equal.
 */
export function isTrustedSender(sender: SenderLike, runtimeId: string, extensionBase: string): boolean {
  if (!sender.id || sender.id !== runtimeId) return false;
  if (!sender.url || !extensionBase.endsWith("/")) return false;
  return sender.url.startsWith(extensionBase);
}
