# Stable tests

CI retries a failed test once and reports every test that needed the retry in the job "Flaky tests" (see [ci.md](ci.md#retries-and-flaky-tests)). A retry only hides the instability. This page collects what made tests fail now and then, mostly under load, and what to do instead.

## Principles

- Every test creates its own data. End-to-end tests get their own organization and administrator from the `organization` fixture for each attempt, and use unique names, addresses and keys, so a test can run alone, in parallel with others and again after a failed attempt.
- A test waits for the state it needs next, never for a time.
- A test does no more work than its assertions need.
- Use serial groups only where the order itself is tested. Tests that change what every organization sees belong in the `instance` project, which runs on one worker (see [web-client.md](web-client.md#end-to-end-tests)).

## Patterns that fail under load

- **Waiting for a fixed time** or for a duration measured on a fast machine. Wait for the condition itself: a promise resolved by the event, `expect.poll` or a Playwright assertion on the state the test needs next. In end-to-end tests, wait for a visible state that means the screen is ready, never for `networkidle`.
- **Too much work.** A test that does much more work than its assertions need (hundreds of import runs, all migrations on an empty database) runs into its timeout on a loaded runner. Make the work as small as the assertion allows.
- **Slow cleanup inside the test body.** `DROP DATABASE` waits for a server-wide checkpoint; test databases are therefore dropped in the background (see [database.md](database.md#tests)). Create what a test needs from the migrated template, not from an empty database.
- **Reading a result that the server records after the response**, such as the first complete download of an export. Wait until the recorded state appears.
- **State shared between runs**: a fixed mail address, or clearing Mailpit for everyone while another run or the development instance waits for its mail. Give each test its own addresses and organization. The end-to-end setup leaves Mailpit as it is for this reason.
- **Acting during a transition**: clicking the next button while the step changes, typing before the editor is ready, or pressing a shortcut before the permissions it checks have loaded. Assert the state that the next action needs (the next step's heading, the editor's save state, the permissions response) before acting.
- **Asserting on text the server shortens or splits**, such as an ID inside a search excerpt. Assert on the link or on a distinct word the test wrote.
- **Accessibility checks that run while a screen loads.** A component must be valid in each of its loading states, not only once it has loaded. For example, a loading row inside a `tree` is hidden from assistive technology while the tree is `aria-busy`, because accessibility checks reject a status element there even in a busy tree or a group.

## Time limits

End-to-end tests fail fast: 15 seconds per action, 45 seconds per navigation, 60 seconds per test, 10 seconds per assertion. Tests that cover many screens, such as the sweeps, call `test.slow()`. Do not raise a limit to make a test pass; find what it waits for.

## Finding the cause

- The artifact `flaky-tests` of a CI run lists every test that needed a retry, with the error of the failed attempt.
- The artifacts `e2e-failed-attempts` and `identity-provider-failed-attempts` hold the trace and the server log of every failed attempt, also when the retry passed.
- The summary of both browser jobs shows the load of the host during the run.
- The weekly stress run runs every job without retries; its failures are load-dependent.
