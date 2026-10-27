export const GETTING_STARTED = `The Lunedo API lets scripts and integrations read and change the data of this instance. Every route is versioned under \`/api/v1\`.

## Create a token

Scripts authenticate with an API token. There are two kinds:

- **Personal tokens** act as your own account. Create one while signed in, in your account settings under Security.
- **Service account tokens** act as a service account of an organization, which keeps working when people leave. Holders of the "integrations and API" area create service accounts and their tokens.

A token starts with \`ld_\` and is shown only once, when it is created. Choose its scopes from the permission areas, each with \`view\` or \`manage\`, and optionally limit it to one organization. At every request, the token can do only what both its scopes and its owner's current permissions allow. A token has no expiry unless you set a date when you create it. If the instance or an organization sets a maximum lifetime, every new token needs a date within it, and a token created without one gets the maximum. Creating and revoking tokens needs a signed-in session; a token cannot manage tokens.

## Your first request

Send the token in the \`Authorization\` header. Tokens in the query string are never accepted, and a request that carries both a session cookie and a token is rejected.

\`\`\`sh
curl -H "Authorization: Bearer ld_..." https://wiki.example.org/api/v1/organizations/{organizationId}
\`\`\`

Requests with a token need no cross-site request header.

## Pagination

Lists return one page at a time:

\`\`\`json
{ "items": [], "nextCursor": "eyJ..." }
\`\`\`

Pass \`nextCursor\` as the \`cursor\` query parameter to get the next page, until \`nextCursor\` is \`null\`. \`limit\` sets the page size, from 1 to 200, default 50.

## Errors

Errors follow RFC 9457 Problem Details with the media type \`application/problem+json\`. Branch on \`type\`; it is stable, for example \`urn:lunedo:problem:forbidden\`. \`code\` repeats its last part. Invalid input lists the affected fields in \`fields\`.

## Rate limits

Each token may send a configurable number of requests per minute, 600 by default. Above that, the API answers \`429\` with the problem type \`urn:lunedo:problem:rateLimited\` and a \`Retry-After\` header with the seconds to wait.
`;
