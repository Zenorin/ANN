# AGENTS.md

## Working rules
- Keep responses compact and result-first.
- Do not modify unrelated files.
- Ask before adding new production dependencies.
- After code changes, run the smallest relevant verification first.
- Report exactly what was verified and what was not verified.

## Project commands
- Install: pnpm install
- Dev: pnpm dev
- Lint: pnpm lint
- Test: pnpm test
- Build: pnpm build

## File routing
- Read only the directories directly related to the task first.
- Avoid broad repo-wide scans unless necessary.

## OpenAI docs
- Always use the OpenAI developer documentation MCP server if the task involves the OpenAI API, ChatGPT Apps SDK, Codex, or related OpenAI developer docs.

## Safety
- Ask before destructive actions such as deleting files, rewriting large areas, or changing deployment/configuration behavior.
