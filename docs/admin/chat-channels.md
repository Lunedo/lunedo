# Chat channels

Lunedo posts what happens in a space, and the announcements of an organization, to Microsoft Teams, Slack, Discord, Matrix or any service that accepts webhooks. A chat channel is a one-way connection: Lunedo posts, nobody answers through it.

## Where to set them up

| What | Where | Who |
|---|---|---|
| Events of a space | **Space settings › Connections › Chat channels** | Space admins of the space |
| Announcements of an organization | **Settings › Organization › Announcements**, section **Post announcements to chat** | Holders of the organization area Integrations and API with Manage; View shows the channels |

A space or an organization posts to at most 20 channels. Confidential and personal spaces cannot have chat channels, so their content stays with their members.

To connect a channel:

1. Set up the other service first, as described in its section below, and copy what it gives you.
2. Select **Connect a channel** and choose the **Service**.
3. Paste the address or the Matrix details.
4. Enter a **Name in Lunedo** of up to 80 characters, for example the name of the channel.
5. Under **Post when**, choose at least one event.
6. Select **Send test message**, check the channel, then **Connect**.

Addresses, access tokens and signing secrets are stored encrypted and never shown again; leave a field empty when editing to keep the stored value. Disconnecting a channel deletes the stored address.

## Events

| Event | Posted when |
|---|---|
| A page is published | The first version of a page is published |
| A page changes (combined per hour) | A later version is published; changes of one page within an hour become one post |
| A blog post is published | The first version of a blog post is published |
| A decision is recorded in a meeting | Five minutes after the decision appears, with its text at that time |
| A page status changes | The status of a page changes |
| Someone comments | A comment or reply is created |
| An announcement starts | The organization's announcement starts (organization channels only) |

Imported versions are not posted.

Only content every member of the space can read is posted: the item is published, not in the trash or archived, and neither it nor a page above it has a view restriction. Comments on such pages are posted. Restricted pages, their comments and drafts never are. The check runs when the event happens and again when the message is sent.

## Microsoft Teams

Lunedo posts an Adaptive Card to a Teams Workflows webhook.

1. In Teams, open the channel and choose **···** › **Workflows**.
2. Pick "Post to a channel when a webhook request is received".
3. Finish the workflow and copy the address it shows.
4. In Lunedo, choose **Microsoft Teams (Workflows)** and paste the address under **Webhook address**.

The operations contacts of the instance can also receive warnings in Teams, see [Notifications](notifications.md#operations-contacts).

## Slack

1. In Slack, create an app with Incoming Webhooks.
2. Add a webhook for the channel.
3. Copy the webhook address.
4. In Lunedo, choose **Slack** and paste it under **Webhook address**.

## Discord

1. In the channel settings, open **Integrations › Webhooks**.
2. Create a webhook and copy its address.
3. In Lunedo, choose **Discord** and paste it under **Webhook address**.

## Matrix

Lunedo posts to a Matrix room as a bot account.

1. Create a bot account on your homeserver and invite it to the room.
2. In the room settings, copy the address of the room or its `matrix.to` link.
3. Sign in as the bot and copy its access token.
4. In Lunedo, choose **Matrix** and enter the **Homeserver address** (for example `https://matrix.example.com`), the **Room** (for example `#ops:example.com`) and the **Access token of the bot**.

When saving, Lunedo checks that the homeserver accepts the token and knows the room.

## Generic webhook

For any other service, choose **Other (webhook)**. Lunedo sends a JSON `POST` request for every event, with the headers `X-Lunedo-Event`, `X-Lunedo-Delivery`, `X-Lunedo-Timestamp` and `X-Lunedo-Signature`.

Requests are signed. After saving, Lunedo shows the signing secret once; copy it then. `X-Lunedo-Signature` holds `sha256=` followed by the HMAC-SHA256 of the `X-Lunedo-Timestamp` header, a dot and the body. Check it before you trust a request. To replace the secret, edit the channel and select **Create a new signing secret**; the current secret stops working when you save.

The body format is described in [Notifications API](../api/notifications.md).

## Addresses and networks

Requests go to public addresses over HTTPS only. Private, loopback and link-local addresses are refused unless they are in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`, see [Configuration](configuration.md); plain HTTP is accepted only for addresses in those networks. The address is checked for every connection, so redirects and changed DNS answers cannot reach other networks.

## Delivery and failures

Messages are queued in the same transaction as the event and sent by a worker, with up to five retries and growing delays. Finished deliveries are deleted after 14 days.

A channel whose service keeps failing, or answers that the address is gone or not allowed, is marked **Failing** with the reason. Its administrators are notified once (event **Space administration**), and nothing more is posted until a test message succeeds or the address is changed. Messages from the failing period are not posted afterwards.

| Reason | What to do |
|---|---|
| The address was removed | Create a new address in the service and paste it under **Edit**. |
| The service refused the message | Create a new address; for Matrix, check that the bot is still in the room and its token is valid. |
| The service did not accept the message | Check that the address belongs to an incoming webhook of that service. |
| No response after several attempts | Send a test message to try again. |
| Not reachable | Check the address and whether the server can reach the internet. |
| Private network | Use a public address, or allow the network in `LUNEDO_OUTBOUND_ALLOWED_NETWORKS`. |
| Not HTTPS | Use an address that starts with `https://`. |
