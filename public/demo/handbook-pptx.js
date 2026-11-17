/* ------------------------------------------------------------------
   Handbook -> PowerPoint export.

   Runs entirely in the browser. pptxgen.bundle.js sits next to this
   file, so the export obeys the same rule as the handbook itself:
   nothing is fetched from a CDN and nothing is asked of the server.
   The page stays usable on an offline VM.

   Parti pris visuel — celui de server/weekly-pptx.js, repris à la
   lettre pour que les deux decks se lisent comme une même collection :
     · 13.333 x 7.5 (16:9 large), Arial, une gouttière unique M = 0.72 ;
     · titres larges ferrés à gauche, le blanc porte la hiérarchie ;
     · aplats gris clair sans bordure, ombres quasi nulles ;
     · rouge de marque en accent, jamais en fond — sauf sur les slides
       d'ouverture de section, où il est le sujet ;
     · slides d'ouverture : filet vertical à 6.66, puce à 4.02, titre
       surdimensionné dans le quadrant bas-droit.

   PIÈGE PptxGenJS conservé de la référence : une forme sans `line`, ou
   avec `line: { width: 0 }`, reçoit un contour gris foncé de 1 pt. La
   seule façon de ne rien dessiner est `line: { type: 'none' }` — à
   garder sur toutes les formes.

   Les captures sont annotées ici, en formes PPTX posées par-dessus
   l'image (puces numérotées + légendes), et non en pixels cuits dans
   le PNG : les repères restent nets à la projection et déplaçables
   dans PowerPoint. Les coordonnées des puces sont exprimées en
   fraction de l'image (0..1), donc indépendantes de sa résolution.

   Le deck est en anglais, volontairement : le handbook est bilingue
   parce qu'il est lu à l'écran par deux publics, un deck qui circule
   demande une seule voix.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  // Palette de weekly-pptx.js, à l'identique.
  var C = {
    brand:     'CF0A2C',
    brandDark: '9E0821',
    brandSoft: 'FDE8EC',
    blue:      '1A73E8',
    blueSoft:  'E8F0FE',
    red:       'D93025',
    redSoft:   'FCE8E6',
    green:     '1E8E3E',
    greenSoft: 'E6F4EA',
    amber:     'F9AB00',
    amberSoft: 'FEF7E0',
    purple:    '9334E6',
    teal:      '12B5CB',
    ink:       '111214',
    mute:      '5F6368',
    faint:     '8A9099',
    line:      'E4E7EA',
    bg:        'FFFFFF',
    bgSoft:    'F5F6F7',
    wash:      'DDEAEE'
  };

  var FONT = 'Arial';
  var M     = 0.72;
  var CW    = 13.333 - M * 2;   // 11.893
  var FLOOR = 6.55;
  var SW = 13.333, SH = 7.5;

  // Teintes de la colonne gauche des slides d'ouverture, reprises de la
  // couverture du rapport hebdo.
  var WASH_INK = '3E555C', WASH_MUTE = '4A6169', WASH_RULE = '9FB8C0';

  /* Corps de texte réduit quand le contenu dépasse la longueur pour
     laquelle la boîte a été dessinée — la fonction de weekly-pptx.js,
     reprise telle quelle. On ne descend pas sous 60 % du corps nominal :
     en dessous la ligne est illisible en projection, et c'est le signe
     qu'il faut donner plus de place au bloc, pas rapetisser encore.

     C'est ce garde-fou qui manquait : les boîtes étaient dimensionnées
     pour le texte le plus court de chaque gabarit, donc les chapitres
     bavards débordaient sur le titre ou sur le pied. */
  function fitPt(text, budget, pt) {
    var len = String(text == null ? '' : text).trim().length;
    if (!len || !budget || len <= budget) return pt;
    return Math.max(pt * 0.6, Math.round(pt * Math.sqrt(budget / len) * 10) / 10);
  }

  var TONE = {
    info:  { c: C.brand, soft: C.brandSoft },
    good:  { c: C.green, soft: C.greenSoft },
    warn:  { c: C.amber, soft: C.amberSoft },
    alert: { c: C.red,   soft: C.redSoft },
    neut:  { c: C.blue,  soft: C.blueSoft }
  };

  /* ==================================================================
     CONTENU

     Un chapitre = une ouverture de section, une slide de propos, ses
     slides de détail, et ses captures annotées.

     `pins` : repères posés sur la capture. `at` est en fraction de
     l'image (x, y de 0 à 1), lue sur la capture réelle. `t` est le
     titre du repère, `d` son explication.
     ================================================================== */

  var CHAPTERS = [
    {
      n: '01', label: 'The floor', kicker: 'Where the day starts',
      title: 'It starts with a screen\nsomeone is watching',
      lead: 'A supervision centre runs on attention. Somebody is looking at alarms right now, and the first question they need answered is never complicated: is anything slipping.',
      body: [
        'The dashboard answers that in one screen. Volumes, how much of the backlog is still inside its deadline, who is carrying the load, and what has already breached.',
        'Nothing here needs a click to be understood, which matters when it is read twenty times a day.'
      ],
      why: 'One control shapes everything else: the Global, SN and CI switch. A country lead selects their perimeter and the entire product narrows to it, sidebar included. A regional lead stays on Global and reads both. Same product, two jobs.',
      shots: [
        {
          file: '01-dashboard.png',
          cap: 'Dashboard · the one screen read twenty times a day',
          pins: [
            { at: [0.805, 0.031], t: 'Perimeter switch', d: 'Global merges both countries. Picking SN or CI narrows every figure below, and the sidebar hides the trackers that no longer apply.' },
            { at: [0.181, 0.207], t: 'Who is on the floor', d: 'A live presence signal held in memory, never stored. It empties on restart and rebuilds within a minute.' },
            { at: [0.228, 0.330], t: 'The KPI row', d: 'Every figure carries a sparkline underneath, so a number is never read without its trend.' },
            { at: [0.680, 0.207], t: 'Period filter', d: 'All time, month, week or a custom range. The whole page recomputes, charts included.' },
            { at: [0.072, 0.253], t: 'Trackers, by country', d: 'The sidebar itself follows the perimeter: a tracker with nothing in it for the selected country is not shown.' },
            { at: [0.916, 0.207], t: 'Excel export', d: 'The active filter set leaves with the file, so a shared export means the same thing as the screen it came from.' }
          ]
        }
      ]
    },

    {
      n: '02', label: 'The ticket', kicker: 'One incident, timed honestly',
      title: 'Something is wrong,\nand the clock starts',
      lead: 'An alarm becomes a ticket. From that second a deadline runs, and the whole point of the tracker is that nobody has to remember it.',
      body: [
        'The clock starts at the occurrence time, not the moment someone typed it in. That single decision is what keeps the measurement honest: an incident found late is still an incident that started early, and a tracker that pretended otherwise would flatter the team.',
        'Critical anomalies carry two deadlines rather than one. Restoring service and fixing the root cause are different promises, so they are timed separately.'
      ],
      why: 'A workaround that holds does not close the underlying problem, and the product refuses to conflate them.',
      timeline: {
        title: 'The countdown, live',
        steps: [
          { t: 'T0', d: 'Occurrence time, not entry time', tone: 'neut' },
          { t: 'Inside the deadline', d: 'Countdown running, nothing owed yet', tone: 'good' },
          { t: 'Near breach', d: 'Warning band, still recoverable', tone: 'warn' },
          { t: 'Breach', d: 'Deadline passed, counted against SLA', tone: 'alert' },
          { t: 'Critical', d: 'Two clocks: service restored, root cause fixed', tone: 'info' }
        ]
      },
      shots: [
        {
          file: '02-tracker-sn.png',
          cap: 'Tracker SN · the working list',
          pins: [
            { at: [0.315, 0.275], t: 'Filters that combine', d: 'Status, priority, owner, domain and a date range, all at once. The count on the right always reflects the active set.' },
            { at: [0.203, 0.341], t: 'Two reference numbers', d: 'Oceane and IMOC identifiers are both carried, because the two systems coexist in the operation. Dropping one would move the reconciliation work elsewhere.' },
            { at: [0.936, 0.212], t: 'New ticket', d: 'The occurrence time is asked for explicitly, which is what lets the clock start before the keyboard did.' },
            { at: [0.802, 0.212], t: 'Export', d: 'The filtered set, not the whole tracker.' },
            { at: [0.604, 0.341], t: 'Priority and severity', d: 'Two separate columns. Severity describes the fault, priority describes what the team owes it.' }
          ]
        }
      ]
    },

    {
      n: '03', label: 'The shift', kicker: 'Who is in the chair',
      title: 'Someone has to be there\nat three in the morning',
      lead: 'Behind every ticket is a rota that put a person in a chair. Planning is where the operation is actually decided.',
      body: [
        'The planning screen builds a rotation across sites and shifts, and the same records feed attendance, handover and the absence balance. A rota kept in a spreadsheet beside the product would drift within a fortnight.',
        'Agents raise their own shift requests. A request is a record with a status, not a message in a chat, so nothing is granted twice and nothing is lost.'
      ],
      why: 'Planning, attendance and absence are one dataset seen three ways. That is what lets an unjustified absence reach the rating without anybody re-typing it.',
      shots: [
        {
          file: '04-shift-planning.png',
          cap: 'Shift Planning · rotation by site and week',
          pins: [
            { at: [0.238, 0.201], t: 'Month, and the year generator', d: 'A full year of rotation is generated in one action, then corrected by hand where reality differs.' },
            { at: [0.190, 0.271], t: 'Site tab', d: 'Each site carries its own rotation. Adding a site does not disturb the others.' },
            { at: [0.355, 0.335], t: 'Week selector', d: 'Six weeks of the month side by side, so a swap is judged in context rather than one day at a time.' },
            { at: [0.649, 0.523], t: 'Assignment', d: 'Click a name to change it. Shifts carry their hours, so a handover gap is visible as a gap.' },
            { at: [0.902, 0.463], t: 'Teams panel', d: 'Team composition per site, which is what the generator rotates through.' },
            { at: [0.427, 0.200], t: 'Weekends and holidays', d: 'Country holidays are marked on their own row, and weekend display can be folded away.' }
          ]
        },
        {
          file: '19-my-requests.png',
          cap: 'My Requests · the agent side of the same records',
          pins: [
            { at: [0.196, 0.208], t: 'Pending', d: 'A request is a record with a status, not a message in a chat. It cannot be granted twice and it cannot be lost.' },
            { at: [0.457, 0.208], t: 'Approved', d: 'Approval writes straight into the rota, so the planning screen and the request never disagree.' },
            { at: [0.732, 0.208], t: 'Rejected', d: 'Kept rather than deleted: a refused request is part of the history a review may need.' },
            { at: [0.946, 0.118], t: 'New request', d: 'Raised by the agent. It goes to Admin for approval, which is the only path that changes the rota.' },
            { at: [0.846, 0.118], t: 'Agent filter', d: 'A manager reads the whole team from the same screen the agent uses for themselves.' }
          ]
        }
      ]
    },

    {
      n: '04', label: 'Absences', kicker: 'Eleven kinds of away',
      title: 'Not all absences\nmean the same thing',
      lead: 'A holiday, a fever and a training day all remove someone from the floor, but treating them alike would be both unfair and wrong.',
      body: [
        'Eleven leave types are defined, each with three properties: does it consume the annual balance, is it paid, can it be planned. Only paid leave and RTT eat into the balance. Sick leave never does, which is the behaviour anyone would expect and yet surprisingly easy to get wrong.'
      ],
      why: 'Days are counted in working days with the country holidays removed, and pending requests are already reserved. A balance that looks available but is about to be consumed would be worse than no balance at all.',
      ledger: {
        title: 'Worked example, one agent over a year',
        rows: [
          { t: 'Annual entitlement', v: '30 days', tone: 'neut' },
          { t: 'Paid leave, approved', v: '10 days, deducted', tone: 'alert' },
          { t: 'Pending', v: '5 days, reserved in advance', tone: 'warn' },
          { t: 'Sick leave', v: '5 days, does not touch the balance', tone: 'good' },
          { t: 'Remaining', v: '15 days · 30 − 10 taken − 5 pending', tone: 'info' }
        ]
      },
      table: {
        title: 'The eleven types, and what each one does',
        head: ['Leave type', 'Deducts', 'Paid', 'Plannable'],
        rows: [
          ['Paid leave', 'Yes', 'Yes', 'Yes'],
          ['RTT', 'Yes', 'Yes', 'Yes'],
          ['Sick leave', 'No', 'Yes', 'No'],
          ['Training', 'No', 'Yes', 'Yes'],
          ['Unpaid leave', 'No', 'No', 'Yes'],
          ['Maternity, paternity', 'No', 'Yes', 'Yes'],
          ['Compassionate leave', 'No', 'Yes', 'No'],
          ['Exceptional leave', 'No', 'Yes', 'Yes'],
          ['Recovery', 'No', 'Yes', 'Yes']
        ]
      },
      note: 'This screen sits behind its own password, separate from administration, because it holds medical reasons and personal balances. No screenshot is published for that reason.'
    },

    {
      n: '05', label: 'Getting better', kicker: 'Training that survives',
      title: 'Learning that actually\ncounts for something',
      lead: 'Training tends to be the first thing announced and the first thing dropped. It survives here because it feeds the rating, and because the way it is scored rewards the behaviour you actually want.',
      body: [
        'The naive approach is to take the best quiz score and stop there. That rewards one good afternoon and ignores everything else. So the score combines four things: how well courses are passed, how many different courses are covered, how consistent the effort is over time, and the level reached.',
        'The practical effect is simple. Retaking the same quiz ten times changes nothing. Passing ten different courses with a steady rhythm takes you to the top of the scale.'
      ],
      why: 'An external certification is worth 100 on its own, since it is attested by a third party and nothing internal replaces that. Experience, level and streak are recomputed on the server at every attempt, so none of it can be adjusted from the browser.',
      weights: {
        title: 'How the skills score is built',
        rows: [
          { t: 'Mastery', d: 'Best score per course', v: 40, tone: 'info' },
          { t: 'Coverage', d: 'How many different courses are passed', v: 25, tone: 'neut' },
          { t: 'Consistency', d: 'The streak, days in a row with activity', v: 20, tone: 'good' },
          { t: 'Level', d: 'The point reached on the path', v: 15, tone: 'warn' }
        ],
        outcome: [
          ['One course, passed once', '50 — and the same course retaken ten times, still 50'],
          ['Five courses, steady rhythm', 'Climbs the scale'],
          ['Full path, every course', 'Top of the scale, level reached']
        ]
      },
      shots: [
        {
          file: '06-quiz.png',
          cap: 'Quiz · the learning path',
          pins: [
            { at: [0.143, 0.298], t: 'Streak, XP, courses', d: 'The three figures that describe a learner. The streak is the one that separates steady effort from a single good afternoon.' },
            { at: [0.484, 0.299], t: 'Level and progress', d: 'A tier every 100 XP, simple enough to hold in your head, which is the whole point.' },
            { at: [0.245, 0.417], t: 'Tiers', d: 'Courses are grouped by level. A tier states how many of its courses are passed and what each is worth.' },
            { at: [0.245, 0.545], t: 'The path', d: 'Orbs trace the order. The one marked "À faire" is the next course actually available.' },
            { at: [0.245, 0.973], t: 'Locked until earned', d: 'A padlock is never a dead end: the card names the course that unlocks it.' },
            { at: [0.437, 0.543], t: 'The contract, up front', d: 'XP, question count, time per question and pass mark are shown before you start, not after.' }
          ]
        }
      ]
    },

    {
      n: '06', label: 'The rating', kicker: 'Six criteria, one number',
      title: 'Six criteria, and where\neach number comes from',
      lead: 'Everything so far converges here. Tickets, absences and training are not separate records, they are the evidence behind a monthly conversation.',
      body: [
        'Four of the six criteria are computed from data the product already holds. The manager can change any of them, and the manual entry always wins, because a month has context that no measurement captures. What the product guarantees is that the starting point is never invented.',
        'A score is the weighted mean of the criteria that were actually filled in, renormalised. Grading four criteria out of six does not mechanically cap the result at 55, which would have punished the manager rather than described the agent.'
      ],
      criteria: {
        title: 'The six criteria and their weights',
        rows: [
          { t: 'SLA', v: 20, src: 'Measured', d: 'Share of tickets held inside their deadline', tone: 'info' },
          { t: 'Process', v: 15, src: 'Entered', d: 'Escalation and notification discipline', tone: 'neut' },
          { t: 'Handover', v: 10, src: 'Entered', d: 'Quality of the shift to shift transmission', tone: 'neut' },
          { t: 'Attendance', v: 15, src: 'Measured', d: 'Unjustified absences and missing notice', tone: 'warn' },
          { t: 'Skills', v: 10, src: 'Measured', d: 'The training path described above', tone: 'good' },
          { t: 'Individual goals', v: 30, src: 'Measured', d: 'Progress, due dates met, agreed actions picked up', tone: 'info' }
        ]
      },
      matrix: {
        title: 'Trust matrix, how the team is positioned',
        cells: [
          { t: 'Grow', d: 'Trusted, results still building', act: 'Coaching, pairing, short horizon goals', tone: 'neut' },
          { t: 'Invest', d: 'Trusted and delivering', act: 'Stretch scope, mentoring others', tone: 'good' },
          { t: 'Clarify', d: 'Results without the trust signals', act: 'Name the expectation explicitly', tone: 'warn' },
          { t: 'Support', d: 'Neither yet established', act: 'Close follow-up, weekly checkpoints', tone: 'alert' }
        ]
      },
      shots: [
        {
          file: '18-fo-dashboard.png',
          cap: 'FO Dashboard · performance per agent, before the rating',
          pins: [
            { at: [0.148, 0.281], t: 'Team SLA rate', d: 'The headline the rating starts from. A ring, not a table, because it is read in a glance.' },
            { at: [0.152, 0.462], t: 'The measured row', d: 'Total, open, in progress, resolved, out of SLA, P1. These are the figures that reach the SLA criterion.' },
            { at: [0.213, 0.803], t: 'Team objectives', d: 'Each target carries its threshold and whether it is met, so "below target" is a fact rather than an opinion.' },
            { at: [0.938, 0.115], t: 'Configure KPI', d: 'The targets themselves are configuration, not code.' },
            { at: [0.789, 0.115], t: 'Perimeter and period', d: 'The same two controls as the dashboard, so the numbers can be tied back to it.' },
            { at: [0.862, 0.283], t: 'Agents without a ticket', d: 'Called out rather than hidden: a zero can mean idle, or it can mean mis-assigned.' }
          ]
        }
      ]
    },

    {
      n: '07', label: 'The review', kicker: 'One page, one person',
      title: 'Sitting down\nwith one person',
      lead: 'A one to one that starts with opening five screens has already lost ten minutes and most of its attention. The agent profile exists to remove that.',
      body: [
        'One page gathers what the product knows: a radar over the six criteria, the goals with their milestones and due dates, the actions agreed last time, and the full interview history. The radar matters because a dent in a shape is spotted before the labels are read, which a column of six numbers never achieves.',
        'Strengths and watch points are derived from the measurements with explicit thresholds. Nothing is asserted without data. A criterion that was never filled in appears in neither column, rather than being quietly counted as a weakness.'
      ],
      why: 'Actions agreed in an interview are extracted line by line and carried to the next one. An action that was never picked up shows as still open, which is usually the most useful thing on the page.',
      twoCol: {
        title: 'What the product infers, and how',
        left: { h: 'Strengths', tone: 'good', items: [
          'SLA held at 92 percent, reliable on deadlines',
          'Goals well advanced, 70 percent',
          'Every due date met this quarter'
        ] },
        right: { h: 'Watch points', tone: 'alert', items: [
          'Training barely started, two courses of ten',
          'Attendance at 65, one unjustified absence',
          'Handover notes thin on recent rotations'
        ] }
      },
      note: 'The team view lists who has had no recent interview, whose goals are overdue and which agreed actions are still waiting. That is a working queue for a manager, not a report to be filed.',
      shots: [
        {
          file: '17-observations.png',
          cap: 'Observations · the ground truth a review draws on',
          pins: [
            { at: [0.196, 0.226], t: 'Status filters', d: 'Open, in progress, closed, all. A review reads the open ones first — they are the ones still owed something.' },
            { at: [0.448, 0.226], t: 'Priority', d: 'The same scale as tickets, so an observation can be weighed against one rather than living in its own vocabulary.' },
            { at: [0.941, 0.156], t: 'Add', d: 'Written by the floor at the moment it was seen, which is what makes it evidence in a review months later.' },
            { at: [0.806, 0.156], t: 'Search', d: 'Across titles and bodies, because an observation is remembered by its words, not its id.' },
            { at: [0.950, 0.226], t: 'The count', d: 'Always reflects the active filters, so an extract is never mistaken for the whole log.' }
          ]
        }
      ]
    },

    {
      n: '08', label: 'Reporting', kicker: 'The same records, upward',
      title: 'Somebody upstairs asks\nhow the month went',
      lead: 'The same records that ran the floor produce the reporting, which is the only way the numbers in a steering committee ever match the numbers on the operations screen.',
      body: [
        'Daily, weekly and monthly reports are generated from live data, and the weekly deck exports to PowerPoint server side with the team layout. That export is deliberately disabled outside the Senegal perimeter, because the template is a Senegal report and letting it run on CI would produce a document that contradicts its own title.',
        'Two companion screens keep the data trustworthy. Data Quality flags tickets with missing fields, impossible dates or contradictory statuses. The Audit Trail records who changed what, when, and what the previous value was.'
      ],
      why: 'Not because someone reconciled two spreadsheets, but because there is only one set of records. Ops Review sits alongside the weekly report for the deeper cut, breaking a period down by domain, priority and affiliate.',
      shots: [
        {
          file: '12-reports.png',
          cap: 'Weekly Report · the deck this export is modelled on',
          pins: [
            { at: [0.129, 0.204], t: 'Week navigation', d: 'Previous, next, or a date. The whole report recomputes from live records.' },
            { at: [0.937, 0.204], t: 'PPTX preview', d: 'The same deck the server generates, previewed before it is sent. This handbook export follows its layout.' },
            { at: [0.855, 0.204], t: 'Excel export', d: 'For the readers who want to re-cut the figures themselves.' },
            { at: [0.240, 0.460], t: 'Weekly volume', d: 'Opened, closed and in progress, with MTTR and MTTD underneath.' },
            { at: [0.740, 0.455], t: 'SLA compliance', d: 'Computed over tickets opened in the period, with the closure rate beside it.' },
            { at: [0.270, 0.845], t: 'Derived insights', d: 'Facts the table does not state: peaks, stalls, tickets open too long. Written by the data, not by hand.' }
          ]
        }
      ]
    },

    {
      n: '09', label: 'Behind the scenes', kicker: 'None of it hard coded',
      title: 'Everything above\nis configurable',
      lead: 'None of the rules described here are hard coded. Deadlines, domains, statuses, team composition, rotation sites, quiz bank, interview template and rating targets all live in configuration.',
      body: [
        'Eleven settings areas sit behind a single unlock that lasts eight hours, reachable from one overview with a search field. The search matches both the title and the description, so looking for the word password finds Access and security without knowing it was called that.',
        'Two areas deserve a mention. Live sessions shows who is connected and on which page, and allows a session to be closed remotely. Access and security is where personal codes are issued for the appraisal view described next.'
      ],
      why: 'A rule that lives in configuration can be corrected by the people who own it. A rule that lives in code needs a developer, which in practice means it stops being corrected at all.',
      areas: {
        title: 'The eleven configurable areas',
        items: [
          'Deadlines and SLA targets', 'Domains and sub-domains', 'Ticket statuses',
          'Team composition', 'Rotation sites and shifts', 'Country holidays',
          'Quiz bank and pass marks', 'Interview template', 'Rating targets and weights',
          'Live sessions', 'Access and security'
        ]
      }
    },

    {
      n: '10', label: 'Who sees what', kicker: 'Enforced on the server',
      title: 'Appraisal data stays\nwhere it belongs',
      lead: 'A rating is a personal record. An interview note is a personal record. The product treats them that way, and the enforcement lives on the server rather than in the interface.',
      body: [
        'That distinction is the whole point. Hiding a screen is not protection if the data has already travelled to the browser, where anyone can read it from the console. The route refuses, not the interface.',
        'An agent reads their own level with a Huawei ID and a personal code issued by their manager. The code is stored hashed and shown once, at creation. The endpoint takes no agent identifier at all, so there is no request shape that returns a colleague’s score, even with a valid session.'
      ],
      table: {
        title: 'Four realms, four secrets',
        head: ['Realm', 'Secret', 'Session', 'Reaches'],
        rows: [
          ['Team', 'Declared identity', 'Browser', 'Trackers, planning, quizzes, reports'],
          ['Administration', 'Shared password', '8 hours', 'Configuration, team, rating targets'],
          ['Absences', 'Own password', 'Separate', 'Balances and medical reasons'],
          ['My performance', 'Huawei ID + personal code', 'Own only', 'Own level and trend, nothing else']
        ]
      },
      shots: [
        {
          file: '16-ma-performance.png',
          cap: 'Ma performance · the gate, not the data',
          pins: [
            { at: [0.315, 0.401], t: 'Huawei ID', d: 'Identifies the agent, but on its own it proves nothing. Colleagues know each other’s IDs, so it is a name, not a secret.' },
            { at: [0.315, 0.451], t: 'Personal code', d: 'Issued by the manager, stored hashed, displayed once at creation. Regenerating it cuts any session opened with the previous one.' },
            { at: [0.315, 0.500], t: 'Show my level', d: 'The endpoint takes no agent identifier at all, so there is no request shape that returns a colleague’s score — even with a valid session.' },
            { at: [0.315, 0.243], t: 'A gate, not a screen', d: 'The route refuses before any data travels. Hiding a screen would be no protection once the figures reached the browser.' },
            { at: [0.315, 0.340], t: 'Stated plainly', d: '“You will only ever see your own level.” The promise is written where the code is typed.' }
          ]
        }
      ]
    }
  ];

  /* ---------- Screenshots ----------
     Les fichiers sont voisins de la page : un aller-retour par canvas
     suffit, aucun appel réseau ne quitte l'onglet. Un fichier absent
     résout à null et la slide est simplement construite sans image. */
  function loadShot(name) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement('canvas');
          cv.width = img.naturalWidth;
          cv.height = img.naturalHeight;
          cv.getContext('2d').drawImage(img, 0, 0);
          resolve({ data: cv.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = 'demo/' + name;
    });
  }

  /* ---------- Chrome ---------- */
  function slideHeader(slide, title, sub, eyebrow) {
    if (eyebrow) {
      slide.addText(String(eyebrow), {
        x: M, y: 0.44, w: 7.5, h: 0.2,
        fontSize: 9, color: C.mute, charSpacing: 0.6, fontFace: FONT
      });
    }
    slide.addText(title, {
      x: M - 0.03, y: eyebrow ? 0.68 : 0.5, w: 9.0, h: 0.82,
      fontSize: 26, bold: true, color: C.ink, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.06
    });
    if (sub) {
      slide.addText(sub, {
        x: 9.9, y: eyebrow ? 0.46 : 0.52, w: CW - 9.18, h: 0.24,
        fontSize: 9.5, color: C.faint, align: 'right', valign: 'middle', fontFace: FONT
      });
    }
  }

  function slideFooter(slide, n, total) {
    slide.addShape('rect', {
      x: M, y: 6.9, w: CW, h: 0.01, fill: { color: C.line }, line: { type: 'none' }
    });
    slide.addText('EMOC · Front Office · Dakar · Internal distribution', {
      x: M, y: 7.0, w: 8, h: 0.24,
      fontSize: 8, color: C.faint, fontFace: FONT, valign: 'middle'
    });
    slide.addText([
      { text: String(n), options: { bold: true, color: C.ink } },
      { text: ' / ' + total, options: { color: C.faint } }
    ], {
      x: M + CW - 1.2, y: 7.0, w: 1.2, h: 0.24,
      fontSize: 8.5, align: 'right', valign: 'middle', fontFace: FONT
    });
  }

  // Ouverture de section : la composition de la couverture du rapport
  // hebdo, en rouge de marque. Le filet à 6.66 et la puce à 4.02 sont
  // les valeurs de la référence, pas des approximations.
  function sectionOpener(slide, ch, page, total) {
    slide.background = { color: C.brand };
    slide.addText(ch.n + ' · ' + ch.label.toUpperCase(), {
      x: M, y: 0.72, w: 5.5, h: 0.24,
      fontSize: 10, color: 'F3C3CA', fontFace: FONT, charSpacing: 0.8
    });
    // La boîte tient ~124 signes à 21 pt avant de mordre sur le bloc de
    // titre (qui commence à 3.42). Au-delà, le corps décroît — tous les
    // chapitres sauf trois dépassaient et empiétaient sur le titre.
    slide.addText(ch.lead, {
      x: M, y: 1.16, w: 5.5, h: 2.2,
      fontSize: fitPt(ch.lead, 124, 21), color: 'EE9BA6', fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.34
    });
    slide.addShape('rect', {
      x: 6.66, y: 0, w: 0.008, h: SH,
      fill: { color: 'E8737F' }, line: { type: 'none' }
    });
    slide.addShape('ellipse', {
      x: 6.615, y: 4.02, w: 0.1, h: 0.1,
      fill: { color: 'FFFFFF' }, line: { type: 'none' }
    });
    slide.addText(ch.title, {
      x: 7.15, y: 3.42, w: CW - 6.43, h: 2.0,
      fontSize: 38, color: 'FFFFFF', fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.06
    });
    slide.addText(ch.kicker, {
      x: 7.18, y: 5.5, w: CW - 6.46, h: 0.3,
      fontSize: 10.5, color: 'F3C3CA', fontFace: FONT
    });
    slide.addText('EMOC · Front Office · Dakar · Internal distribution', {
      x: M, y: 7.0, w: 8, h: 0.24,
      fontSize: 8, color: 'E8919C', fontFace: FONT, valign: 'middle'
    });
    slide.addText([
      { text: String(page), options: { bold: true, color: 'FFFFFF' } },
      { text: ' / ' + total, options: { color: 'E8919C' } }
    ], {
      x: M + CW - 1.2, y: 7.0, w: 1.2, h: 0.24,
      fontSize: 8.5, align: 'right', valign: 'middle', fontFace: FONT
    });
  }

  // Aplat gris clair + titre, le conteneur générique du deck.
  function panel(slide, o) {
    slide.addShape('rect', {
      x: o.x, y: o.y, w: o.w, h: o.h,
      fill: { color: o.fill || C.bgSoft }, line: { type: 'none' }
    });
    if (o.title) {
      slide.addText(o.title, {
        x: o.x + 0.3, y: o.y + 0.24, w: o.w - 0.6, h: 0.26,
        fontSize: 11, bold: true, color: C.ink, fontFace: FONT, valign: 'middle'
      });
    }
  }

  /* ---------- Capture annotée ----------
     L'image est posée dans la bande libre, et les repères sont dessinés
     par-dessus en formes : puce numérotée sur le point, légende
     numérotée en colonne à droite. Les puces sont placées d'après `at`,
     exprimé en fraction de l'image — la capture peut changer de
     résolution sans déplacer un repère. */
  function annotatedShot(slide, shot, sh, page, total, ch) {
    slideHeader(slide, shot.cap, ch.n + ' · ' + ch.label, 'Screen');

    var legendW = 3.5;
    var gap = 0.34;
    var top = 1.62;
    var availW = CW - legendW - gap;
    var availH = FLOOR - top;

    var r = Math.min(availW / sh.w, availH / sh.h);
    var dw = sh.w * r, dh = sh.h * r;
    var ix = M, iy = top;

    // Cadre : un filet clair sous l'image, pour la décoller du blanc
    // sans lui poser de bordure dure.
    slide.addShape('rect', {
      x: ix - 0.04, y: iy - 0.04, w: dw + 0.08, h: dh + 0.08,
      fill: { color: C.bgSoft }, line: { type: 'none' }
    });
    slide.addImage({ data: sh.data, x: ix, y: iy, w: dw, h: dh });

    var pins = shot.pins || [];
    var D = 0.26;   // diamètre de la puce

    pins.forEach(function (p, i) {
      var cx = ix + p.at[0] * dw;
      var cy = iy + p.at[1] * dh;
      // Halo blanc : la puce doit rester lisible sur une capture sombre
      // comme sur une claire.
      slide.addShape('ellipse', {
        x: cx - D / 2 - 0.03, y: cy - D / 2 - 0.03, w: D + 0.06, h: D + 0.06,
        fill: { color: 'FFFFFF' }, line: { type: 'none' }
      });
      slide.addShape('ellipse', {
        x: cx - D / 2, y: cy - D / 2, w: D, h: D,
        fill: { color: C.brand }, line: { type: 'none' }
      });
      slide.addText(String(i + 1), {
        x: cx - D / 2, y: cy - D / 2, w: D, h: D,
        fontSize: 9, bold: true, color: 'FFFFFF', fontFace: FONT,
        align: 'center', valign: 'middle'
      });
    });

    // Légende. La hauteur de ligne suit le nombre de repères pour que
    // six tiennent au-dessus du plancher sans se chevaucher. La colonne
    // est calée sur la marge droite : l'ancrer à la largeur de l'image
    // la faisait dépasser de la gouttière quand la capture était large.
    var lx = M + CW - legendW;
    var step = Math.min(0.86, availH / Math.max(1, pins.length));
    pins.forEach(function (p, i) {
      var ly = top + i * step;
      slide.addShape('ellipse', {
        x: lx, y: ly + 0.02, w: 0.2, h: 0.2,
        fill: { color: C.brand }, line: { type: 'none' }
      });
      slide.addText(String(i + 1), {
        x: lx, y: ly + 0.02, w: 0.2, h: 0.2,
        fontSize: 7.5, bold: true, color: 'FFFFFF', fontFace: FONT,
        align: 'center', valign: 'middle'
      });
      slide.addText(p.t, {
        x: lx + 0.3, y: ly, w: legendW - 0.38, h: 0.22,
        fontSize: fitPt(p.t, 28, 9.5), bold: true, color: C.ink,
        fontFace: FONT, valign: 'middle'
      });
      // Le budget suit la place réellement disponible : avec six repères
      // la ligne est plus courte qu'avec trois, donc le corps s'ajuste
      // au lieu de couler sous le repère suivant.
      slide.addText(p.d, {
        x: lx + 0.3, y: ly + 0.22, w: legendW - 0.38, h: step - 0.26,
        fontSize: fitPt(p.d, Math.round((step - 0.26) * 290), 8),
        color: C.mute, fontFace: FONT,
        valign: 'top', lineSpacingMultiple: 1.2
      });
    });

    slideFooter(slide, page, total);
  }

  /* ---------- Deck ---------- */
  async function build() {
    var pptx = new PptxGenJS();
    // LAYOUT_WIDE = 13.33 x 7.5, comme weekly-pptx.js. Surtout pas
    // LAYOUT_16x9 : c'est le même rapport mais sur 10 pouces de large,
    // donc toutes les coordonnées de ce fichier (filet à 6.66, marge
    // droite à 12.61, pied à 6.90) tombaient hors de la page et le
    // contenu débordait à droite et en bas.
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'EMOC · Front Office · Dakar';
    pptx.title = 'EMOC Tracker, Handbook';

    // Chargées d'abord : un décodage lent ne doit pas s'entrelacer avec
    // la construction et réordonner le deck.
    var shots = {};
    var files = [];
    CHAPTERS.forEach(function (ch) {
      (ch.shots || []).forEach(function (s) { files.push(s.file); });
    });
    await Promise.all(files.map(function (f) {
      return loadShot(f).then(function (r) { if (r) shots[f] = r; });
    }));

    // Plan établi avant le rendu : la numérotation doit être connue
    // d'avance, comme dans le rapport hebdo.
    var plan = [];
    CHAPTERS.forEach(function (ch) {
      plan.push({ ch: ch, kind: 'open' });
      plan.push({ ch: ch, kind: 'lead' });
      if (ch.timeline) plan.push({ ch: ch, kind: 'timeline' });
      if (ch.ledger)   plan.push({ ch: ch, kind: 'ledger' });
      if (ch.weights)  plan.push({ ch: ch, kind: 'weights' });
      if (ch.criteria) plan.push({ ch: ch, kind: 'criteria' });
      if (ch.matrix)   plan.push({ ch: ch, kind: 'matrix' });
      if (ch.twoCol)   plan.push({ ch: ch, kind: 'twoCol' });
      if (ch.areas)    plan.push({ ch: ch, kind: 'areas' });
      if (ch.table)    plan.push({ ch: ch, kind: 'table' });
      (ch.shots || []).forEach(function (s) {
        if (shots[s.file]) plan.push({ ch: ch, kind: 'shot', shot: s });
      });
    });
    var TOTAL = plan.length + 2;   // + couverture + sommaire
    var page = 0;

    /* --- Couverture --- */
    var cover = pptx.addSlide();
    cover.background = { color: C.wash };
    cover.addText('EMOC · Front Office · Dakar', {
      x: M, y: 0.72, w: 5.2, h: 0.24, fontSize: 10, color: WASH_MUTE, fontFace: FONT
    });
    cover.addText(
      'One incident followed through the product, from the moment it reaches the floor '
      + 'to the monthly review it eventually feeds. Ten chapters, in the order the work '
      + 'actually happens, with the screens that carry each step.', {
        x: M, y: 1.1, w: 5.2, h: 1.6,
        fontSize: 13, color: WASH_INK, fontFace: FONT,
        valign: 'top', lineSpacingMultiple: 1.4
      });
    cover.addShape('rect', {
      x: 6.66, y: 0, w: 0.008, h: SH, fill: { color: WASH_RULE }, line: { type: 'none' }
    });
    cover.addShape('ellipse', {
      x: 6.615, y: 4.02, w: 0.1, h: 0.1, fill: { color: C.brand }, line: { type: 'none' }
    });
    cover.addText('Handbook', {
      x: 7.15, y: 3.42, w: CW - 6.43, h: 2.0,
      fontSize: 52, bold: true, color: C.ink, fontFace: FONT,
      valign: 'top', lineSpacingMultiple: 1.02
    });
    cover.addText('EMOC Tracker · version 2.8', {
      x: 7.18, y: 5.52, w: CW - 6.46, h: 0.3, fontSize: 13, color: WASH_INK, fontFace: FONT
    });
    cover.addShape('rect', {
      x: M, y: 5.6, w: 1.4, h: 0.026, fill: { color: WASH_RULE }, line: { type: 'none' }
    });
    cover.addText('Front Office Team', {
      x: M, y: 5.78, w: 5.2, h: 0.26, fontSize: 11.5, bold: true, color: C.ink, fontFace: FONT
    });
    cover.addText('Internal distribution · no live data in this deck', {
      x: M, y: 6.04, w: 5.2, h: 0.24, fontSize: 9.5, color: WASH_MUTE, fontFace: FONT
    });

    /* --- Sommaire --- */
    var toc = pptx.addSlide();
    slideHeader(toc, 'Ten chapters', 'Handbook', 'Contents');
    var half = Math.ceil(CHAPTERS.length / 2);
    CHAPTERS.forEach(function (ch, i) {
      var col = i < half ? 0 : 1;
      var row = i - col * half;
      var x = M + col * (CW / 2 + 0.2);
      var y = 1.86 + row * 0.92;
      toc.addText(ch.n, {
        x: x, y: y, w: 0.5, h: 0.3,
        fontSize: 15, bold: true, color: C.brand, fontFace: FONT
      });
      toc.addText(ch.label, {
        x: x + 0.52, y: y - 0.02, w: CW / 2 - 0.8, h: 0.26,
        fontSize: 12.5, bold: true, color: C.ink, fontFace: FONT, valign: 'middle'
      });
      toc.addText(ch.kicker, {
        x: x + 0.52, y: y + 0.24, w: CW / 2 - 0.8, h: 0.24,
        fontSize: fitPt(ch.kicker, 34, 9), color: C.mute, fontFace: FONT, valign: 'top'
      });
      toc.addShape('rect', {
        x: x, y: y + 0.56, w: CW / 2 - 0.3, h: 0.008,
        fill: { color: C.line }, line: { type: 'none' }
      });
    });
    slideFooter(toc, ++page + 1, TOTAL);   // couverture non numérotée en 1
    page = 1;

    /* --- Chapitres --- */
    plan.forEach(function (item) {
      var ch = item.ch, s = pptx.addSlide();
      page++;

      if (item.kind === 'open') { sectionOpener(s, ch, page, TOTAL); return; }

      if (item.kind === 'lead') {
        slideHeader(s, ch.title.replace('\n', ' '), ch.n + ' · ' + ch.label, 'Chapter');
        // Les paragraphes se suivent à pas fixe : un paragraphe long
        // rétrécit plutôt que de recouvrir le suivant.
        var y = 1.86;
        ch.body.forEach(function (p) {
          s.addText(p, {
            x: M, y: y, w: 7.4, h: 1.18,
            fontSize: fitPt(p, 330, 12.5), color: C.ink, fontFace: FONT,
            valign: 'top', lineSpacingMultiple: 1.4
          });
          y += 1.24;
        });
        if (ch.why) {
          panel(s, { x: 8.4, y: 1.86, w: CW - 7.68, h: 3.3, fill: C.brandSoft });
          s.addText('WHY', {
            x: 8.7, y: 2.12, w: 1.4, h: 0.22,
            fontSize: 8.5, bold: true, color: C.brandDark, fontFace: FONT, charSpacing: 0.8
          });
          s.addText(ch.why, {
            x: 8.7, y: 2.42, w: CW - 8.28, h: 2.6,
            fontSize: fitPt(ch.why, 480, 10.5), color: C.ink, fontFace: FONT,
            valign: 'top', lineSpacingMultiple: 1.34
          });
        }
        if (ch.note) {
          s.addText(ch.note, {
            x: M, y: 5.62, w: 7.4, h: 1.0,
            fontSize: fitPt(ch.note, 320, 9), italic: true, color: C.faint,
            fontFace: FONT, valign: 'top', lineSpacingMultiple: 1.3
          });
        }
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'timeline') {
        slideHeader(s, ch.timeline.title, ch.n + ' · ' + ch.label, 'How it is timed');
        var st = ch.timeline.steps;
        var cw2 = (CW - (st.length - 1) * 0.18) / st.length;
        st.forEach(function (step, i) {
          var x = M + i * (cw2 + 0.18);
          var t = TONE[step.tone] || TONE.info;
          s.addShape('rect', {
            x: x, y: 2.1, w: cw2, h: 2.5, fill: { color: t.soft }, line: { type: 'none' }
          });
          s.addShape('rect', {
            x: x, y: 2.1, w: cw2, h: 0.05, fill: { color: t.c }, line: { type: 'none' }
          });
          s.addText(String(i + 1), {
            x: x + 0.24, y: 2.36, w: 0.4, h: 0.3,
            fontSize: 14, bold: true, color: t.c, fontFace: FONT
          });
          s.addText(step.t, {
            x: x + 0.24, y: 2.78, w: cw2 - 0.48, h: 0.6,
            fontSize: fitPt(step.t, 24, 12), bold: true, color: C.ink, fontFace: FONT,
            valign: 'top', lineSpacingMultiple: 1.1
          });
          s.addText(step.d, {
            x: x + 0.24, y: 3.42, w: cw2 - 0.48, h: 1.0,
            fontSize: fitPt(step.d, 130, 9), color: C.mute, fontFace: FONT,
            valign: 'top', lineSpacingMultiple: 1.26
          });
        });
        s.addText('The clock starts at the occurrence time. An incident found late is still an incident that started early.', {
          x: M, y: 4.9, w: CW, h: 0.3,
          fontSize: 10, italic: true, color: C.faint, fontFace: FONT
        });
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'ledger') {
        slideHeader(s, ch.ledger.title, ch.n + ' · ' + ch.label, 'Worked example');
        var ly = 2.0;
        ch.ledger.rows.forEach(function (r) {
          var t = TONE[r.tone] || TONE.neut;
          s.addShape('rect', {
            x: M, y: ly, w: 0.05, h: 0.62, fill: { color: t.c }, line: { type: 'none' }
          });
          s.addShape('rect', {
            x: M + 0.05, y: ly, w: CW - 0.05, h: 0.62,
            fill: { color: C.bgSoft }, line: { type: 'none' }
          });
          s.addText(r.t, {
            x: M + 0.34, y: ly, w: 4.0, h: 0.62,
            fontSize: fitPt(r.t, 30, 12), bold: true, color: C.ink, fontFace: FONT, valign: 'middle'
          });
          s.addText(r.v, {
            x: M + 4.4, y: ly, w: CW - 4.7, h: 0.62,
            fontSize: fitPt(r.v, 52, 11.5), color: t.c, fontFace: FONT, valign: 'middle'
          });
          ly += 0.72;
        });
        s.addText('Working days, country holidays removed, pending requests already reserved.', {
          x: M, y: ly + 0.12, w: CW, h: 0.3,
          fontSize: 10, italic: true, color: C.faint, fontFace: FONT
        });
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'weights') {
        slideHeader(s, ch.weights.title, ch.n + ' · ' + ch.label, 'Scoring');
        var wy = 1.96;
        ch.weights.rows.forEach(function (r) {
          var t = TONE[r.tone] || TONE.info;
          s.addText(r.t, {
            x: M, y: wy, w: 2.2, h: 0.34,
            fontSize: fitPt(r.t, 18, 12), bold: true, color: C.ink, fontFace: FONT, valign: 'middle'
          });
          s.addText(r.d, {
            x: M + 2.24, y: wy, w: 3.5, h: 0.34,
            fontSize: fitPt(r.d, 44, 9.5), color: C.mute, fontFace: FONT, valign: 'middle'
          });
          // Barre de poids : la longueur EST l'information.
          var barX = M + 5.9, barW = CW - 6.6;
          s.addShape('rect', {
            x: barX, y: wy + 0.09, w: barW, h: 0.17,
            fill: { color: C.bgSoft }, line: { type: 'none' }
          });
          s.addShape('rect', {
            x: barX, y: wy + 0.09, w: barW * (r.v / 40), h: 0.17,
            fill: { color: t.c }, line: { type: 'none' }
          });
          s.addText(r.v + '%', {
            x: M + CW - 0.62, y: wy, w: 0.62, h: 0.34,
            fontSize: 10.5, bold: true, color: C.ink, fontFace: FONT,
            align: 'right', valign: 'middle'
          });
          wy += 0.5;
        });
        panel(s, { x: M, y: wy + 0.16, w: CW, h: 2.0, title: 'What that produces' });
        var oy = wy + 0.72;
        ch.weights.outcome.forEach(function (o) {
          s.addText(o[0], {
            x: M + 0.3, y: oy, w: 3.6, h: 0.3,
            fontSize: fitPt(o[0], 30, 10.5), bold: true, color: C.ink, fontFace: FONT, valign: 'middle'
          });
          s.addText(o[1], {
            x: M + 4.0, y: oy, w: CW - 4.4, h: 0.3,
            fontSize: fitPt(o[1], 62, 10), color: C.mute, fontFace: FONT, valign: 'middle'
          });
          oy += 0.42;
        });
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'criteria') {
        slideHeader(s, ch.criteria.title, ch.n + ' · ' + ch.label, 'The scale');
        var cy2 = 1.9;
        // En-tête de colonnes, en petites capitales grises.
        [['Criterion', M, 2.4], ['Weight', M + 2.5, 0.9], ['Source', M + 3.5, 1.1],
         ['What it measures', M + 4.7, CW - 4.7]].forEach(function (h) {
          s.addText(h[0].toUpperCase(), {
            x: h[1], y: cy2, w: h[2], h: 0.2,
            fontSize: 7.5, bold: true, color: C.faint, charSpacing: 0.4,
            fontFace: FONT, valign: 'middle'
          });
        });
        s.addShape('rect', {
          x: M, y: cy2 + 0.22, w: CW, h: 0.008, fill: { color: C.line }, line: { type: 'none' }
        });
        var ry = cy2 + 0.36;
        ch.criteria.rows.forEach(function (r) {
          var t = TONE[r.tone] || TONE.info;
          s.addText(r.t, {
            x: M, y: ry, w: 2.4, h: 0.52,
            fontSize: fitPt(r.t, 17, 12), bold: true, color: C.ink, fontFace: FONT, valign: 'middle'
          });
          // Le poids porte sa barre, pour que 30 se lise comme le triple
          // de 10 sans avoir à comparer deux nombres.
          s.addShape('rect', {
            x: M + 2.5, y: ry + 0.19, w: 0.84 * (r.v / 30), h: 0.14,
            fill: { color: t.c }, line: { type: 'none' }
          });
          s.addText(String(r.v), {
            x: M + 2.5, y: ry - 0.14, w: 0.84, h: 0.3,
            fontSize: 10, bold: true, color: C.ink, fontFace: FONT, valign: 'middle'
          });
          s.addText(r.src, {
            x: M + 3.5, y: ry, w: 1.1, h: 0.52,
            fontSize: 9.5, bold: true, fontFace: FONT, valign: 'middle',
            color: r.src === 'Measured' ? C.green : C.mute
          });
          s.addText(r.d, {
            x: M + 4.7, y: ry, w: CW - 4.7, h: 0.52,
            fontSize: fitPt(r.d, 60, 10), color: C.mute, fontFace: FONT, valign: 'middle'
          });
          s.addShape('rect', {
            x: M, y: ry + 0.54, w: CW, h: 0.008,
            fill: { color: C.line }, line: { type: 'none' }
          });
          ry += 0.62;
        });
        s.addText('A score is the weighted mean of the criteria actually filled in, renormalised — so grading four of six does not cap the result at 55.', {
          x: M, y: ry + 0.14, w: CW, h: 0.4,
          fontSize: 10, italic: true, color: C.faint, fontFace: FONT,
          valign: 'top', lineSpacingMultiple: 1.3
        });
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'matrix') {
        slideHeader(s, ch.matrix.title, ch.n + ' · ' + ch.label, 'Positioning');
        var cellW = (CW - 0.3) / 2, cellH = 1.9;
        ch.matrix.cells.forEach(function (c, i) {
          var col = i % 2, row = Math.floor(i / 2);
          var x = M + col * (cellW + 0.3), y2 = 1.94 + row * (cellH + 0.28);
          var t = TONE[c.tone] || TONE.neut;
          s.addShape('rect', {
            x: x, y: y2, w: cellW, h: cellH, fill: { color: t.soft }, line: { type: 'none' }
          });
          s.addShape('rect', {
            x: x, y: y2, w: 0.05, h: cellH, fill: { color: t.c }, line: { type: 'none' }
          });
          s.addText(c.t, {
            x: x + 0.34, y: y2 + 0.26, w: cellW - 0.68, h: 0.38,
            fontSize: 17, bold: true, color: t.c, fontFace: FONT, valign: 'middle'
          });
          s.addText(c.d, {
            x: x + 0.34, y: y2 + 0.7, w: cellW - 0.68, h: 0.4,
            fontSize: fitPt(c.d, 40, 11), color: C.ink, fontFace: FONT, valign: 'top'
          });
          s.addText(c.act, {
            x: x + 0.34, y: y2 + 1.16, w: cellW - 0.68, h: 0.6,
            fontSize: fitPt(c.act, 56, 9.5), color: C.mute, fontFace: FONT,
            valign: 'top', lineSpacingMultiple: 1.24
          });
        });
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'twoCol') {
        slideHeader(s, ch.twoCol.title, ch.n + ' · ' + ch.label, 'What the data says');
        [ch.twoCol.left, ch.twoCol.right].forEach(function (colDef, ci) {
          var t = TONE[colDef.tone] || TONE.neut;
          var x = M + ci * (CW / 2 + 0.16), w = CW / 2 - 0.16;
          s.addShape('rect', {
            x: x, y: 1.94, w: w, h: 2.9, fill: { color: t.soft }, line: { type: 'none' }
          });
          s.addShape('rect', {
            x: x, y: 1.94, w: w, h: 0.05, fill: { color: t.c }, line: { type: 'none' }
          });
          s.addText(colDef.h.toUpperCase(), {
            x: x + 0.32, y: 2.2, w: w - 0.64, h: 0.28,
            fontSize: 9.5, bold: true, color: t.c, charSpacing: 0.8, fontFace: FONT
          });
          var iy2 = 2.64;
          colDef.items.forEach(function (it) {
            s.addShape('ellipse', {
              x: x + 0.34, y: iy2 + 0.1, w: 0.1, h: 0.1,
              fill: { color: t.c }, line: { type: 'none' }
            });
            s.addText(it, {
              x: x + 0.56, y: iy2, w: w - 0.9, h: 0.6,
              fontSize: fitPt(it, 56, 10.5), color: C.ink, fontFace: FONT,
              valign: 'top', lineSpacingMultiple: 1.3
            });
            iy2 += 0.66;
          });
        });
        if (ch.note) {
          s.addText(ch.note, {
            x: M, y: 5.06, w: CW, h: 0.7,
            fontSize: fitPt(ch.note, 260, 10), italic: true, color: C.faint, fontFace: FONT,
            valign: 'top', lineSpacingMultiple: 1.3
          });
        }
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'areas') {
        slideHeader(s, ch.areas.title, ch.n + ' · ' + ch.label, 'Configuration');
        var items = ch.areas.items;
        var perCol = Math.ceil(items.length / 3);
        items.forEach(function (it, i) {
          var col = Math.floor(i / perCol), row = i % perCol;
          var x = M + col * (CW / 3), y2 = 1.96 + row * 0.56;
          s.addShape('rect', {
            x: x, y: y2, w: CW / 3 - 0.24, h: 0.44,
            fill: { color: C.bgSoft }, line: { type: 'none' }
          });
          s.addShape('rect', {
            x: x, y: y2, w: 0.04, h: 0.44, fill: { color: C.brand }, line: { type: 'none' }
          });
          s.addText(it, {
            x: x + 0.22, y: y2, w: CW / 3 - 0.5, h: 0.44,
            fontSize: fitPt(it, 30, 10), color: C.ink, fontFace: FONT, valign: 'middle'
          });
        });
        s.addText('One unlock, eight hours, one search field that matches titles and descriptions alike.', {
          x: M, y: 5.5, w: CW, h: 0.3,
          fontSize: 10, italic: true, color: C.faint, fontFace: FONT
        });
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'table') {
        slideHeader(s, ch.table.title, ch.n + ' · ' + ch.label, 'Reference');
        var t2 = ch.table;
        var head = t2.head.map(function (c) {
          return { text: c, options: {
            bold: true, color: 'FFFFFF', fill: { color: C.ink },
            fontFace: FONT, fontSize: 9.5
          } };
        });
        var rows = [head].concat(t2.rows.map(function (r, ri) {
          return r.map(function (c, ci) {
            var isYes = c === 'Yes', isNo = c === 'No';
            return { text: c, options: {
              fontFace: FONT, fontSize: 9.5,
              bold: ci === 0 || isYes || isNo,
              color: ci === 0 ? C.ink : (isYes ? C.green : isNo ? C.faint : C.mute),
              fill: { color: ri % 2 ? C.bgSoft : C.bg }
            } };
          });
        }));
        s.addTable(rows, {
          x: M, y: 1.94, w: CW,
          colW: colWidths(t2.head.length, CW),
          border: { type: 'solid', pt: 0.5, color: C.line },
          rowH: 0.32, valign: 'middle', margin: 0.08
        });
        if (ch.note) {
          s.addText(ch.note, {
            x: M, y: 5.9, w: CW, h: 0.6,
            fontSize: fitPt(ch.note, 300, 9.5), italic: true, color: C.faint, fontFace: FONT,
            valign: 'top', lineSpacingMultiple: 1.3
          });
        }
        slideFooter(s, page, TOTAL);
        return;
      }

      if (item.kind === 'shot') {
        annotatedShot(s, item.shot, shots[item.shot.file], page, TOTAL, ch);
        return;
      }
    });

    /* --- Clôture --- */
    var end = pptx.addSlide();
    end.background = { color: C.ink };
    end.addText(
      'Ten chapters, one dataset. The numbers in a steering committee match the numbers '
      + 'on the floor because there is only one set of records.', {
        x: M, y: 0.72, w: 5.5, h: 2.0,
        fontSize: 21, color: '8A9099', fontFace: FONT,
        valign: 'top', lineSpacingMultiple: 1.34
      });
    end.addShape('rect', {
      x: 6.66, y: 0, w: 0.008, h: SH, fill: { color: '3A3D42' }, line: { type: 'none' }
    });
    end.addShape('ellipse', {
      x: 6.615, y: 4.02, w: 0.1, h: 0.1, fill: { color: C.brand }, line: { type: 'none' }
    });
    end.addText('Thank you', {
      x: 7.15, y: 3.42, w: CW - 6.43, h: 2.0,
      fontSize: 40, color: 'FFFFFF', fontFace: FONT, valign: 'top'
    });
    end.addText('EMOC Tracker · Handbook · no live data in this deck', {
      x: 7.18, y: 5.5, w: CW - 6.46, h: 0.3,
      fontSize: 10.5, color: '8A9099', fontFace: FONT
    });

    await pptx.writeFile({ fileName: 'EMOC_Tracker_Handbook.pptx' });
  }

  function colWidths(n, total) {
    if (n <= 1) return [total];
    var first = Math.min(3.0, total * 0.26);
    var rest = (total - first) / (n - 1);
    var out = [first];
    for (var i = 1; i < n; i++) out.push(rest);
    return out;
  }

  /* ---------- Bouton ---------- */
  var btn = document.getElementById('dl-pptx');
  if (!btn) return;
  var label = btn.querySelector('span');
  var original = label ? label.textContent : '';

  btn.addEventListener('click', function () {
    if (btn.disabled) return;
    btn.disabled = true;
    if (label) label.textContent = 'Building…';
    build().then(function () {
      if (label) label.textContent = 'Downloaded';
      setTimeout(function () {
        if (label) label.textContent = original;
        btn.disabled = false;
      }, 2200);
    }).catch(function (err) {
      console.error('PPTX export failed:', err);
      if (label) label.textContent = 'Failed, see console';
      btn.disabled = false;
      setTimeout(function () { if (label) label.textContent = original; }, 3000);
    });
  });
})();
