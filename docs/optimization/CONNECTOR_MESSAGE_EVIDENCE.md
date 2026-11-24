# O14 message evidence

Connector diagnostics distinguish reachability, account identity, directory
access and messages. For the built-in Feishu HTTP adapter only, an ordinary
authorized reply can now record provider acceptance and the remote message ID
from the existing API response. The connector UI exposes presence flags only.
It does not expose message text, identifiers, credential material or the
context fingerprint. No additional provider action or permission is introduced.

Evidence requires a previously verified bot, the existing fresh bot identity
match, an explicit configured chat and the exact reply target, including chat,
root and parent IDs from Feishu. The response must identify the configured
app as the sender. The settings/identity revisions and the live
adapter's keyed credential/configuration basis must remain current. Replacing or
restarting the adapter invalidates this evidence conservatively. CLI and test
transports do not produce it. Incomplete provider responses add no evidence and
do not change delivery status or retry decisions. The latest qualifying receipt
per source is stored after the existing outbox acknowledgement; a diagnostic
storage error does not roll back the send.

Provider acceptance and a remote message ID are not independent readback or
callback and do not establish delivery. The message status remains
`not_tested` even with those two recorded facts. Native inbound events continue
on their existing path and are not correlated by this implementation.
