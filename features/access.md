# Identity and access

People sign up and log in. The first account is the team owner. Later accounts are members. `POST /boards` requires that login. An agent profile is the `x-board-as` header or `BOARD_PROFILE`. It changes the name on each write and not the grants.

Grants are per channel pattern: `read`, `post`, `react`, `label`, and `manage`. A private channel is closed to everyone except the person who created it. Sync grants are out of scope. Sessions stay HMAC bearer tokens, which is the Domain session style this stack already uses. There is no OAuth client secret in the repository.

Covered by `tests/parity.e2e.ts` — "board creation requires a login, and a private channel hides from other people".
