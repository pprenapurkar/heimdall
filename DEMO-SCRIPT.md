# Heimdall demo video script

Target length: 2 to 3 minutes. Talk like you are showing a colleague what you built. Read it through twice, then say it in your own words so it does not sound read. Short sentences, normal voice, a little energy.

## Before you hit record (2 minute setup)

- Open the live Vercel URL in a clean browser window. Close other tabs.
- Zoom the page to about 110 to 125 percent so text is readable on video.
- Make sure the three runs are showing (green, yellow, red).
- Open the red run once beforehand so you know it loads, then go back to the home page to start.
- Do NOT click "Reset demo" during recording (that button is not wired for the live backend yet).
- Have the architecture diagram (README) or the `db:proof` output in another tab if you want the closing shot.
- Record at 1080p. Keep the mouse calm, move with intent, pause a beat after each click.

## The script

Each row: what to do on screen, and what to say while you do it.

---

**[0:00 to 0:20] The problem**

DO: Start on the Heimdall home page (or a plain title slide for the first few seconds, your call).

SAY:
> "Companies are handing real work to AI agents now. Issuing refunds, touching customer data, calling tools on their own. The problem is, once the agent runs, you usually can't prove what it actually did, or whether it stayed inside the rules. And normal logs can be edited, so they don't hold up if someone asks you to prove it. That is the gap I built Heimdall to close."

---

**[0:20 to 0:40] The home page and the verdicts**

DO: Point at the three runs. Hover over each colored badge.

SAY:
> "This is Heimdall, a flight recorder for autonomous AI agents. Every run an agent does gets a verdict. Green means it stayed on task. Yellow means it cut a corner. Red means it broke the rules. And the important part is that all of this is decided inside the database, in Aurora Postgres, not in app code sitting on top of it."

---

**[0:40 to 0:50] Open the rogue run**

DO: Click the red run, "Rogue refund agent."

SAY:
> "Let's open the red one. This was a refund agent that went off the rails."

---

**[0:50 to 1:05] Policy as data**

DO: Point at the "Declared intent" panel (goal, allowed tools, required steps, prohibited).

SAY:
> "First, here is what the agent was actually allowed to do. Its goal, the tools it could use, the step it had to take, and the things it was banned from. This isn't a config file somewhere. It lives as data in the database, and it's what every check gets measured against."

---

**[1:05 to 1:25] Drift findings**

DO: Scroll to the drift findings list.

SAY:
> "And here is where it went wrong. It called a competitor pricing tool it was never allowed to touch. It wrote an unsupported note into memory. And the database flagged that its output had drifted away from its real goal, using a vector similarity check. That last one is a real semantic comparison, not keyword matching."

---

**[1:25 to 1:40] Trace timeline**

DO: Scroll through the timeline. Pause on the highlighted drift step.

SAY:
> "This is the full timeline of what the agent did, step by step, in the open telemetry format. The exact step where it went off track is highlighted right here, so you can see the moment it happened."

---

**[1:40 to 2:00] Tamper-evident audit chain**

DO: Show the audit panel with the "audit verified" badge.

SAY:
> "Now the part that matters for compliance. Every event is hash chained, basically a small tamper-evident ledger inside Postgres. If anyone edits a single record after the fact, this check fails and points to exactly where. Right now it says verified, which means this record is provably untouched."

---

**[2:00 to 2:15] Cost after drift, then the export**

DO: Show the cost-after-drift numbers. Then click "Export Art. 12 bundle" and let the JSON download.

SAY:
> "It also shows the money side. Most of the spend on this run happened after it had already gone wrong. So you don't just hear that it drifted, you see what it cost. And with one click I can export a full compliance bundle, built for the EU AI Act, Article 12, which from next year requires exactly this kind of tamper-evident record for high risk AI."

---

**[2:15 to 2:35] Aurora is the backend, close**

DO: Optional, cut to the architecture diagram or the `db:proof` output for a few seconds.

SAY:
> "The part I'm proud of is that Amazon Aurora Postgres is doing all the real work here. The judging, the vector similarity, the hash chain, the compliance export, it's all SQL. The database isn't storage behind the app. It basically is the app. Thanks for watching."

---

## Quick tips so it sounds human, not read

- Use contractions. Say "it's" and "you can't," not "it is" and "you cannot."
- Pause for half a second after each click. Let the screen catch up.
- It's fine to stumble or restart a sentence. That sounds more real than a perfect take.
- Do not list features in a flat monotone. Land the three verdict colors and the "provably untouched" line with a little weight, those are the moments that sell it.
- If you run long, the lines you can trim are the cost-after-drift sentence and the timeline beat. Keep problem, verdicts, drift, hash chain, and Aurora.

## One safety note for the recording

If you accidentally need to restore the demo data, do it off camera with the manual psql seed, not the Reset button. The Reset button still hits the deferred array-write path and will error on the live backend.
