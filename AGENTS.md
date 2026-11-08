# AGENTS.md

## Driving the Unreal editor

UE 5.8 ships an MCP server inside the editor (plugin identifier `ModelContextProtocol`,
shown in the Plugins browser as *Unreal MCP*). This project enables it together with
`AllToolsets`, which is what actually supplies the actor, scene, material and object tools.
Without `AllToolsets` the server still starts but advertises only `AgentSkillToolset`, which
cannot touch a level.

The endpoint is loopback HTTP only: `http://127.0.0.1:<port>/mcp`, default port `8000`,
default path `/mcp`. There is no authentication layer and it must not be exposed beyond the
machine. The live port comes from Editor Preferences → General → Model Context Protocol →
Server Port Number, or from the editor console command `ModelContextProtocol.StartServer
[port]`. On a machine where 8000 is already bound — a GPU vendor utility often owns it — the
server has to be started with an explicit port such as 8123.

### Tool Search is on by default

`bEnableToolSearch` defaults to true, so `tools/list` returns three meta-tools instead of
hundreds of concrete ones:

| Meta-tool | Arguments | Returns |
| --- | --- | --- |
| `list_toolsets` | none | registered toolset names and descriptions |
| `describe_toolset` | toolset name | JSON schema for every tool in that toolset |
| `call_tool` | toolset name, tool name, arguments object | the tool's result, same turn |

A concrete tool is never advertised directly. The sequence is `list_toolsets` once per
session, `describe_toolset` before the first use of a toolset, then `call_tool`. Guessing a
tool name wastes a turn; the schema returned by `describe_toolset` is the only authority on
argument names, types and required fields.

### Rules that matter when calling tools

- Calls are serialized onto the game thread: one at a time, and the editor UI blocks while
  each one runs. Do not issue overlapping calls.
- Mutating a level is destructive. Save first, prefer a reversible call, and ask before
  replacing anything that was placed by hand.
- A client that connected before a toolset changed keeps the old catalogue until the editor
  console runs `ModelContextProtocol.RefreshTools` and the client reconnects.
- Editor logs land in `ue/HouseArrest/Saved/Logs/`.

### Small local models

A 9B-class model follows this protocol only when the prompt states it: name the sequence
("call `list_toolsets`, then `describe_toolset` for the actor toolset, then `call_tool`").
Do not switch Tool Search off to make the surface seem simpler — that advertises every tool
eagerly and will not fit a modest local context window.
