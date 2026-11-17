# FOps — 3-minute platform presentation

## 1. Opening (0:00–0:30)

FOps is the single workspace of our Front Office supervision team in Dakar and Abidjan: tickets, SLA, shifts, people and reporting in one place, with an AI assistant built in.

> "Every morning, a Front Office manager juggles open tickets, SLA clocks, shift coverage, absences, One-to-Ones and monthly scores, usually across five tools and a few spreadsheets. FOps puts all of it in one platform, for both sites, and adds Big Brother, an assistant that turns that data into decisions. In the next three minutes: what the platform does, then how the AI helps."

## 2. The platform (0:30–1:15)

Six modules cover the manager's week; each is one sentence on stage.

> "Here is what the team uses every day."

| Module | What it does | One line to say |
| --- | --- | --- |
| Trackers and SLA | SN and CI tickets with live time left, breach and near-breach alerts | "The SLA clock stops at closure, business hours included, so a ticket closed on Friday is never a false breach." |
| Dashboard | Volume, SLA compliance, workload heatmap by agent, absence rate | "Red only means something is wrong: breaches, low compliance." |
| Planning and absences | Shift rota, leave requests and approvals, coverage by slot | "We see who is on shift, and who is missing, before the day starts." |
| Team and performance | Monthly scorecards with automatic measures (SLA, tasks, attendance, skills) | "Scores update themselves; the manager is told when a sheet has moved, and can set a month as neutral." |
| One-to-One and objectives | Guided sessions, agreed actions, SMART objectives with milestones | "What we promise in a One-to-One is tracked until it is done." |
| Reports and access | Weekly combined report, PDF exports, personal codes per agent, HTTPS | "Every change is signed by a named person, and reserved pages stay reserved." |

## 3. Big Brother, the AI (1:15–2:30)

Big Brother turns FOps data into decisions, and the rule is simple: FOps computes the facts, the AI reads them, and every figure on screen can be checked.

```
Manager asks ──> FOps computes ──> Big Brother reads ──> FOps renders
(skill or         (names become      (decides and         (table, PDF,
 question)         aliases)           words it)            widget)
                                         │ model slow or down
                                         ▼
                                  No-AI fallback ──> report still arrives
                                  (FOps uses the same figures)
```

For a plain-language search, the model only returns the query; FOps runs it on the real data, so no records ever leave the platform.

> "Big Brother is the manager's home page. It opens on today: open tickets and breaches, who is on shift and who is absent, my subjects to handle, and the worries noted in One-to-Ones that still need follow-up. One click, Prioritise with Big Brother, and it proposes the order to tackle them."

> "Then come the skills. The Decision report reads the week or the month for one country and gives at most three decisions: the facts with their numbers, two or three options, a recommendation, and what happens if we do nothing. The Team review says who to recognise and who to support. The One-to-One recap and preparation turn meeting notes into themes, commitments and questions."

> "And I can simply ask. Who did not close their ticket on Friday? How many absences per agent in September? Big Brother translates the question into a search, FOps runs it on the real data, and I get the table, with Big Brother's reading of my question so I can check it."

> "It works like a colleague, not a spinner. Skills run in the background and tell me exactly where they are, one sentence at a time. Results can be pinned as widgets on the home page, refreshed, filtered by country or exported as a clean PDF."

> "Finally, trust. Agents' names leave FOps only as aliases, Agent 01, Agent 02, and come back on screen. The search sends no data at all, only the question. And if the model is slow or down, the Decision report still arrives, computed by FOps from the same figures."

- **Home cockpit**: tickets, shifts, absences, One-to-One follow-ups, prioritisation.
- **Skills**: Decision report, Team review, One-to-One recap and preparation, weekly comment, root-cause analysis, writing help, agent insights.
- **Ask in plain words**: natural-language search over tickets, absences, planning, tasks, One-to-Ones and observations.
- **Workflow**: background jobs with live steps, pinned widgets, country filter, PDF export.
- **Safeguards**: pseudonymised agents, no ticket detail sent, no-AI fallback, every number traceable.

## 4. Close (2:30–3:00)

End on the outcome: less time collecting data, faster and better-argued decisions, and a team that is followed fairly.

> "FOps gives the manager one place for the whole team, in both countries. Big Brother turns that place into decisions: what to do today, what to decide this week, and the answer to any question about our data, in seconds and with the evidence. Next, we move the data to a proper database and keep adding skills where managers lose the most time. Thank you."

## 5. Demo checklist

The script reads in about 3 minutes at a calm pace (around 400 words); show one screen per section.

1. **0:30** Dashboard in simple mode, then Team › Agents with the performance update panel.
2. **1:15** Big Brother home: Operations, My subjects, My day, One-to-One follow-ups; click Prioritise.
3. **1:45** Launch the Decision report on Dakar; while the steps scroll, point at the live sentences.
4. **2:05** Type "Who did not close their ticket on Friday?" in the composer and show the table.
5. **2:20** Pin the decision report, show it on the home page, download the PDF.

- [ ] Big Brother connected (green dot in the rail) before going on stage
- [ ] Decision report run once beforehand and pinned, in case the model is slow
- [ ] Browser zoom at 90% so the home widgets fit on the projector
