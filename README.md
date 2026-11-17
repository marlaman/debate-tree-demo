# Debate Tree

A local, single-user debate workspace built with Next.js, React Flow, TypeScript, and SQLite. Start with a rough thought about what to debate. Grok shapes it into a short draft for you to review before it is saved. You can add stances and arguments in your own words, or use **Auto fill** on a debate to add two opposing stances and on a stance to add three arguments. Arguments appear one at a time and are scored as they arrive. The tree runs top to bottom; drag nodes, pan and zoom, or click a node to focus it and open its details on the right. Saved debates live in the collapsible sidebar.

## Run locally

Requires Node.js 22.13+ (Node 24 recommended).

```sh
npm install
cp .env.example .env.local # First setup only; do not overwrite an existing key.
npm run dev
```

Open http://127.0.0.1:3000. The server binds to your local machine. The workspace starts empty. All debates, stances, and arguments are created by you. No content or scores are seeded.

For drafting and scoring, set `XAI_API_KEY` in `.env.local` and restart the server. `XAI_MODEL` defaults to `grok-4.7`; set it to a structured-output-capable model available to your xAI account. Keys are server-only and environment files are ignored by Git. Normal xAI API usage charges apply.

Drafting and Auto fill require a key. New and edited arguments are scored automatically after saving. Existing arguments have a **Score with Grok** button. Refreshing reuses stored assessments. Failures preserve argument text and provide a retry action. If you include source URLs in your rough argument, the app attaches them to the argument; Grok does not invent sources. Auto fill suggestions have no fabricated citations or source links and append to existing content.

## Scoring

- Factual support and evidence: 40 points
- Logical validity and assumptions: 40 points
- Relevance to the stance: 20 points
- Stance score: arithmetic mean of scored arguments, rounded to one decimal. Unscored arguments are excluded; zero is a valid score.

Arguments with scores above 50 are green; scores of 50 or below are red. Stance averages use a neutral progress bar instead of the argument colors.

The request includes the debate, stance, argument, and supplied sources. Grok returns a score, explanation, strengths, and weaknesses via its Responses API with a JSON schema; results are validated before storage. There is no web browsing or source verification. These are AI assessments of argument quality, not objective truth ratings.

Editing a debate, stance, or argument invalidates affected assessments. Scoring uses a database claim to prevent simultaneous duplicate calls and rejects results whose context changed while the request was running. Requests time out after 90 seconds, and abandoned scoring claims can be retried after two minutes.

## Storage and scope

Data lives in `data/debates.sqlite` (SQLite WAL mode), outside source control. To back up a stopped app, copy the `data` directory. `DEBATE_DB_PATH` can override the database location for tests. Node's built-in `node:sqlite` may emit an experimental warning on some supported Node versions.

By default this version is local and single-user, with no login. Set `PUBLIC_SHARING=1` to enable the anonymous publish flow described below.

## Share publicly

`render.yaml` describes a Render web service with a persistent disk for SQLite. Push this project to a Git repository, create a Render Blueprint from it, and supply `XAI_API_KEY` in Render's environment-variable prompt. The Blueprint enables `PUBLIC_SHARING=1` and stores the database at `/var/data/debates.sqlite`; the local `data` directory and `.env.local` are ignored and are not uploaded.

In sharing mode, visitors get private anonymous drafts using an HttpOnly session cookie. Starting a new debate prompts them to publish the current draft as public read-only content or discard it. Unpublished drafts expire after seven days. Published debates are visible to everyone and cannot be edited or deleted through the app. Anonymous sessions are tied to the browser cookie; clearing it removes access to that browser's unpublished drafts.

This is intended for a small, trusted audience. The Grok key remains server-side, but visitors can still cause API usage charges. The Render service and disk use a paid plan.

## Checks

```sh
npm run typecheck
npm test
npm run build
npm start
```

Tests cover drafting, averaging, durable storage, cascading deletion, score invalidation, stale scoring rejection, input/origin validation, and the Grok request/response contract using mocked network responses. A real Grok call requires a configured API key.
