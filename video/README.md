# Demo video (under 3 minutes)

The voiceover is generated with ElevenLabs from `narration.json`: eight short clips, about 2 min 30 s in total. You record the screen to match each clip, then lay the clips over the recording.

## 1. Make the voiceover

Add your ElevenLabs key to `.env.local`:

```
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=JBFqnCBsd6RMkjVDRZzb   # "George", British. Pick any voice from your ElevenLabs library.
```

Then:

```
npm run voiceover               # all eight clips → video/audio/01-hook.mp3 … 08-close.mp3
npm run voiceover 05-evidence   # redo one clip after editing its text
```

Listen to each clip. If a line sounds stiff, change the wording in `narration.json` and regenerate just that clip. Short sentences and commas give the most natural pauses.

## 2. Record the screen

- **Browser:** Chrome or Edge at 1440×900 (or 1920×1080), zoom 100%, bookmarks bar hidden, a single tab.
- **Recorder:** Windows Game Bar (Win + Alt + R), OBS, or the Clipchamp recorder.
- **Before you start:** run `npm run dev` and open http://localhost:3000.
- **Pace:** record each scene as a separate take. It's easier than one long take.

| # | Clip | On screen | Tips |
|---|---|---|---|
| 1 | 01-hook (~17 s) | The empty RegPulse home page: "Which new rules touch Northbridge this week?" Slowly scroll the FCA consultations page in another tab first if you like. | Keep the mouse still. |
| 2 | 02-firm (~14 s) | Click **Policy library**. Click POL-INTRO, then PROC-COLL, so the controls and owners show. | |
| 3 | 03-sweep (~23 s) | Pick **Live regulator search** (or the captured corpus) and click **Run sweep**. Watch steps 1–2 tick on the left. Cut to the **Publications** tab showing Yes and No. | The live sweep takes ~35 s; speed it up 2× in the editor. |
| 4 | 04-board (~12 s) | The finished headline sentence and the **Impact board**. | For a guaranteed result, use **Load recorded run**. |
| 5 | 05-evidence (~28 s) | Click the **High** row: *Introducer and Broker Oversight Policy*. The evidence view opens: highlighted FCA sentence on the left, policy with the audit gap on the right. | Hover over the highlight and the "Quote found verbatim" tick. |
| 6 | 06-guardrail (~11 s) | Stay on the evidence view, or cut to the "uncited claims dropped" fact in the strip. | |
| 7 | 07-ticket (~13 s) | Click **Draft change ticket** (wait for it) → the ticket. Hover **Download Jira CSV** / **Download Pega cases**. Then the **Ask RegPulse** tab: click "What do we need to do about introducers after the Annex 1 action?" | Cut out the waiting time. |
| 8 | 08-close (~28 s) | The "33s vs ~11 min" fact on the board, then the **Models and cost** tab: the green callout with the 93% saving, then the model table. End on the home page or a title card with the repo URL. | |

## 3. Put it together

Clipchamp (free on Windows) works fine:

1. Drop the eight screen takes on the timeline in order.
2. Put each MP3 under its take, and trim or speed up the video to match the audio.
3. Optionally add quiet background music at about 10% volume.
4. Export at 1080p and check it's under 3:00.
5. Upload to YouTube as **Public** (not Unlisted), and paste the link into Devpost.

## The script (as read)

The text below is exactly what's in `narration.json`.

1. If you work in compliance at a UK lender, you'll know the feeling. Every week the FCA, the PRA and the ICO publish more than anyone can read properly. Someone still has to decide what actually matters for your firm. Usually by hand, in a spreadsheet.
2. This is RegPulse. I've given it a sample firm, Northbridge Business Finance, a small lender in Manchester. It knows Northbridge's fifteen policies and process maps, who owns each one, and the controls inside them.
3. When I run a sweep, Tavily searches the regulators' websites for the dates I choose and brings back clean text. Then a small, fast model, Nemotron Nano, reads every publication and asks one question. Does this apply to us? Fund rules, crypto, and anything that's PRA only, drop out straight away.
4. The ones that matter go to Nemotron Ultra, which reads each one against the whole policy library. Here's a recorded run from this month. Fourteen changes, two of them high priority, each with an owner and a date.
5. Here's the one I'd look at first. The FCA has restricted six unregulated lenders over money laundering. Nothing to do with Northbridge, you'd think. But the same press release reminds regulated firms to check the registration of the Annex 1 firms they deal with. Some of Northbridge's introducers are exactly that. RegPulse found the open audit point in the introducer policy, and put the regulator's own words right next to it.
6. Every finding has to quote the source word for word. If the quote isn't really there, the finding is thrown away. You can't act on a rule that doesn't exist.
7. From here I can draft the change ticket, or export everything as Jira tickets or Pega cases. Or I can just ask a question, and the answer comes back with its sources.
8. Just reading those eleven pages would take a person about eleven minutes, before mapping anything. That whole sweep took thirty-three seconds and cost about eight cents on Nebius Token Factory. Sending the triage to Nano instead of Ultra cut that step's cost by ninety-three percent. It's open source, and you can try it on your own policies. RegPulse. So the one rule that matters doesn't get lost in the pile.

The numbers in scenes 3, 4 and 8 come from the recorded run (`data/recorded-run.json`): 11 publications, 6 relevant, 14 changes, 2 high, 33 seconds, ~11 minutes' reading (2,626 words at 238 wpm), $0.08, 93% triage saving. If you record a different run, update them.
