# Contributing

Thanks for the interest in the project. This file tells how the work goes.

## The rules of the project

The rules live in [AGENTS.md](AGENTS.md). It describes the decisions of the project and the reasons behind them. Read it before a big change: it explains why the agent lives in the extension host, why the client of MiniMax is written by hand, and what the panel looks like.

The short version:

- The agent cycle lives only in the extension host. The webview does not go to the network and does not keep the key.
- The texts of the interface are in English. The texts that go to the model are always in English. The documentation of the project is in Russian.
- Every file of the project stays under 400 lines. A file that grew over the limit is split by meaning, not renamed.
- The public API of the extension stays on the old paths: the tools, the state of the panel and the storage are imported from there.

## The setup

```bash
npm install
npm run compile
npm test
npm run typecheck
```

The panel can be looked at without VS Code:

```bash
npm run preview
```

It opens http://localhost:5199. The parameters `?theme=light`, `?busy=1`, `?collapse=1`, `?empty=1` and `?nokey=1` show the states of the panel.

## The live tests

The live tests hit the real API and need a key of the M Plan:

```bash
npm run test:live
```

The key comes from `MINIMAX_API_KEY` in the environment or from `.env.local` in the root of the project. The file is in `.gitignore` and never reaches the repository.

## The pull requests

1. A branch from `main`.
2. The types pass and the tests pass: `npm run typecheck && npm test`.
3. A new behavior is covered by a test. The name of the test says what it checks.
4. The change of the panel follows the styleguide: [docs/styleguide.md](docs/styleguide.md).
5. The commit text follows the rules of Conventional Commits, the line is in Russian, in the imperative: `feat(панель): список изменённых файлов показывает добавленные`.
6. The version in `package.json` goes up by semver: a patch for a fix, a minor for a new capability. The number lands in the name of the `.vsix` and in the badge of the panel.

## The publishing

The extension reaches the Visual Studio Marketplace through Trusted Publishing: the workflow asks GitHub for an OIDC token and the Marketplace exchanges it for a session token. No PAT is stored in the repository.

The policy on the Marketplace side points at the workflow file `.github/workflows/publish.yml`:

| Field | Value |
| --- | --- |
| Policy name | Publish MiniMax Agent |
| Provider | GitHub Actions |
| Repository owner | thepirateclub |
| Repository | minimax-vscode |
| Workflow | publish.yml |
| Environment | empty, the workflow does not use a GitHub environment |

A tag of the form `v*` starts the workflow: it checks the types, runs the tests and publishes the extension. The `Release` workflow builds the `.vsix` and keeps it as an artifact of the run.

## The security

The API key never reaches the repository, the logs or the webview. If you find a way to make it leak, that is a bug worth a report, and the details of the report stay out of the public issue.

## The license

By sending a pull request you agree that your work goes under the MIT license of the project.
