# Security

## The supported versions

| Version | Supported |
| --- | --- |
| 0.42.x | yes |
| < 0.42 | no |

## What to report

Send a private report through the security tab of the repository, or by mail to the author. Describe what you found, how to reproduce it and what the wrong behavior is.

The following is worth a report:

- The API key reaches the logs, the webview or the network traffic.
- A path of the tools leaves the root of the workspace.
- A write to disk or a run of a command happens without the confirmation.
- The model gets around the confirmation of a write or a command.

Please do not open a public issue for these until the fix is ready. A public issue with the details of the hole gives the attack a head start.

## What the extension does by itself

- The key lives in the secret storage of VS Code. It is read at the moment of the request and never written into the state of the panel.
- The paths of the tools are resolved inside the root of the workspace only. A path outside it is refused.
- Every write to disk and every run of a command asks for the confirmation in the panel.
- The address of the API, the list of the confirmations and the path to ffmpeg have the scope `application`: a repository that the user opens cannot move the key to another host or switch the confirmations off.
- The address of the API is accepted only over https, and a host that is not an official one asks for the confirmation.
- A ref of git that the model gives is not read as an option of git, so the model cannot point a write to a file of the index.
- The original of a file is saved before the write, so the change can be rolled back.
