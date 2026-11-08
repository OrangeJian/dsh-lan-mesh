# Room Composer: published DSH compatibility baseline

Verified against installed DSH **0.2.2-rc.1**. Run `npm run check:composer-compat` after upgrading DSH.
The check discovers a local installation first, then `npm root -g`; it resolves package metadata and public client entry points without executing browser modules in Node.
All four packages below are **0.2.2-rc.1**.

| Capability / public client entry | Reusable public contract | Scope requirement | Room-owned fallback |
| --- | --- | --- | --- |
| @deepseek-ai/dsh-client-ui-conversation/client | ConversationController, UiConversation; InputState, DraftInput, DraftReference, ComposerAttachment, InputZone types via /client | Conversation input registry and editor mutations require a real Session scope; exported types are reusable without one | Room owns draft text, reference chips, keyboard editing, send action and attachment state; no InputBar import |
| @deepseek-ai/dsh-client-ui-attachment/client | apply, inject via /client; ComposerAttachment types via conversation/client | Plugin renders conversation.input.attachments and message image slots; native uploads require Host Session receipt lifecycle | Room owns picker/paste/drop, upload lifecycle, preview/remove/retry, and durable mesh attachment payload |
| @deepseek-ai/dsh-client-ui-input-trigger/client | InputTriggerService, InputTriggerController, InputTriggerSource, InputTriggerCandidate, ReferenceCodec via /client | Source roster is root-level, but sessionOf(actx), controller, input events and ClientSessionContext require SessionId | Room owns slash/at detection, candidate menu, keyboard routing and atomic chip insertion; never fabricate a Session |
| @deepseek-ai/dsh-client-ui-skill/client | apply, inject via /client; registers slash source and skill tool row, no standalone public skill-picker component | skillCatalog is a SessionReferenceSourceMap augmentation; catalog RPC, resolving references and source picks require Session controller/Agent capability | Room owns skill catalog adapter, search/list, chip data and serializable reference materialization |

## Integration rules

Only package root and `/client` entry points are required. The published export map also advertises `./src/*`, but source files are excluded from the published files list: this is not a usable component API. Do not use source or bundle-private paths, even where a wildcard appears to allow resolution.

**InputBar is not a public named export** of the conversation client declarations. No Room implementation may import it or extract it from a bundle. Public type shapes do not imply that the native editor or a standalone skill picker is exported.

The full published export maps and exact client injection requirements are recorded below. Those root service dependencies must be available to activate native plugins; availability does not create a Session scope for Room. Root plugin `apply` functions register native behavior, rather than renderable standalone components.

Native command execution, queue/steering submit semantics, Session reference catalog/resolution, Agent/workspace-backed file and skill sources, scoped draft initialization, upload receipts and reference serialization are **Session-only**: use a **Room-owned fallback** for each. Keep Room message routing, pending state, reference storage/materialization and send transactions in Room. Shared public types and visual primitives may inform that adapter; do not spoof a SessionId or send Room content to a native Session submit action.

## Machine-checked snapshot

The check fails if any required client target/declaration disappears, DSH version/export/injection metadata drifts, classifications are absent, the npm script is absent, or Room's browser entry requires DSH private paths/InputBar. This is a metadata compatibility baseline, not a browser rendering or behavioral test. Declaration and scope analysis above was performed manually; review it again on version drift.

```json
{
  "dshVersion": "0.2.2-rc.1",
  "privateImportsRequired": false,
  "packages": [
    {
      "id": "@deepseek-ai/dsh-client-ui-conversation",
      "version": "0.2.2-rc.1",
      "exports": {
        ".": {
          "types": "./lib/types/index.d.ts",
          "default": "./lib/index.js"
        },
        "./client": {
          "types": "./lib/types/client/index.d.ts",
          "default": "./lib/client.js"
        },
        "./src/*": "./src/*",
        "./package.json": "./package.json",
        "./locale/*.json": "./locale/*.json"
      },
      "inject": [
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-client-file-upload",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-workspace",
        "@deepseek-ai/dsh-client-ui-context-menu"
      ]
    },
    {
      "id": "@deepseek-ai/dsh-client-ui-attachment",
      "version": "0.2.2-rc.1",
      "exports": {
        ".": {
          "types": "./lib/types/index.d.ts",
          "default": "./lib/index.js"
        },
        "./client": {
          "types": "./lib/types/client/index.d.ts",
          "default": "./lib/client.js"
        },
        "./src/*": "./src/*",
        "./package.json": "./package.json",
        "./locale/*.json": "./locale/*.json"
      },
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-chat",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-trajectory",
        "@deepseek-ai/dsh-client-ui-tool",
        "@deepseek-ai/dsh-client-ui-file-drag",
        "@deepseek-ai/dsh-client-ui-context-menu"
      ]
    },
    {
      "id": "@deepseek-ai/dsh-client-ui-input-trigger",
      "version": "0.2.2-rc.1",
      "exports": {
        ".": {
          "types": "./lib/types/index.d.ts",
          "default": "./lib/index.js"
        },
        "./client": {
          "types": "./lib/types/client/index.d.ts",
          "default": "./lib/client.js"
        },
        "./src/*": "./src/*",
        "./package.json": "./package.json",
        "./locale/*.json": "./locale/*.json"
      },
      "inject": [
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-renderer"
      ]
    },
    {
      "id": "@deepseek-ai/dsh-client-ui-skill",
      "version": "0.2.2-rc.1",
      "exports": {
        ".": {
          "types": "./lib/types/index.d.ts",
          "default": "./lib/index.js"
        },
        "./client": {
          "types": "./lib/types/client/index.d.ts",
          "default": "./lib/client.js"
        },
        "./src/*": "./src/*",
        "./package.json": "./package.json",
        "./locale/*.json": "./locale/*.json"
      },
      "inject": [
        "@deepseek-ai/dsh-api-session-controller",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-ui-tool",
        "@deepseek-ai/dsh-client-ui-input-trigger",
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-ui-sidebar-right"
      ]
    }
  ],
  "capabilities": [
    {
      "package": "conversation",
      "publicContract": "ConversationController, UiConversation; InputState, DraftInput, DraftReference, ComposerAttachment, InputZone types via /client",
      "scope": "Conversation input registry and editor mutations require a real Session scope; exported types are reusable without one",
      "fallback": "Room owns draft text, reference chips, keyboard editing, send action and attachment state; no InputBar import",
      "fallbackOwner": "Room-owned fallback"
    },
    {
      "package": "attachment",
      "publicContract": "apply, inject via /client; ComposerAttachment types via conversation/client",
      "scope": "Plugin renders conversation.input.attachments and message image slots; native uploads require Host Session receipt lifecycle",
      "fallback": "Room owns picker/paste/drop, upload lifecycle, preview/remove/retry, and durable mesh attachment payload",
      "fallbackOwner": "Room-owned fallback"
    },
    {
      "package": "input-trigger",
      "publicContract": "InputTriggerService, InputTriggerController, InputTriggerSource, InputTriggerCandidate, ReferenceCodec via /client",
      "scope": "Source roster is root-level, but sessionOf(actx), controller, input events and ClientSessionContext require SessionId",
      "fallback": "Room owns slash/at detection, candidate menu, keyboard routing and atomic chip insertion; never fabricate a Session",
      "fallbackOwner": "Room-owned fallback"
    },
    {
      "package": "skill",
      "publicContract": "apply, inject via /client; registers slash source and skill tool row, no standalone public skill-picker component",
      "scope": "skillCatalog is a SessionReferenceSourceMap augmentation; catalog RPC, resolving references and source picks require Session controller/Agent capability",
      "fallback": "Room owns skill catalog adapter, search/list, chip data and serializable reference materialization",
      "fallbackOwner": "Room-owned fallback"
    }
  ]
}
```

