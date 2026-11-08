# @md-editor/i18n

Localization for the desktop app, the web playground, the website and the plugins. It is built on [i18next](https://www.i18next.com/) and [react-i18next](https://react.i18next.com/).

## Languages

| Locale | File | Role |
| :--- | :--- | :--- |
| `zh` (Simplified Chinese) | `src/locales/zh.ts` | Source dictionary. Key types are derived from it. |
| `zh-Hant` | `src/locales/zh-Hant.ts` | Traditional Chinese |
| `en` | `src/locales/en.ts` | English |
| `ja` | `src/locales/ja.ts` | Japanese |

All four dictionaries must have the same keys. `tests/i18n.test.ts` fails when a key is missing from any of them.

`t("...")` is typed against the `zh` dictionary through i18next's `CustomTypeOptions`, so unknown keys are type errors and the editor can complete them.

The language setting is `"system"` (follow the operating system) or one of the four locale codes. `detectSystemLocale` and `resolveActiveLocale` resolve it.

## Usage

In a React component:

```tsx
import { useTranslation } from "@md-editor/i18n";

export function StatusBar() {
  const { t } = useTranslation();
  return <div>{t("common.saved")}</div>;
}
```

Outside React:

```typescript
import { t, changeLanguage } from "@md-editor/i18n";

const label = t("common.confirm");
await changeLanguage("en");
```

## Development

```bash
pnpm test
pnpm typecheck
```
