# ODWD Autopilot

Types laboratory, nurse and nurse attendant duty entries into the Online Daily Work Diary
(http://www.misocc-hrmis.net/odwd/index.php) and saves them.

The program is one file: `ODWD-Autopilot-1.6.0.exe`. Copy it anywhere, including a USB stick,
and open it. Nothing is installed. It makes a folder named `ODWD-Autopilot-data` beside itself
for your settings and duties.

## Start screen
Every launch plays a short animated start screen (click or press a key to skip it), then a
reminder: the app types your diary, but it is not an excuse to get lazy. Enter only work you
really did and read every entry before it is saved. Press **I understand**, then answer **What
section are you?** (Laboratory, Nurse or Nurse Attendant; last time's answer is ready). The diary site loads
after that. Change your section later with the **Lab** / **Nurse** / **NA** button at the top.

## Preview
- **F8** shows a preview first: every entry that will be saved, with date, times, time spent and
  description, laid out like your daily logs. **Start** sends exactly those; **Cancel** sends
  nothing.
- **Preview** under a duty shows how that whole duty will look, including entries that cannot be
  sent yet. Nothing is sent from there.
- With **F6** you check each entry on the site itself before clicking Save Task.

**About** shows the version.

## First run
Do this once, so the app is proven against the real site before you let it save by itself.

1. Open the app. If Windows says "Windows protected your PC", choose **More info**, then
   **Run anyway** (the app is not signed). Opening takes a few seconds.
2. Log in on the site, in the right half of the window. Your PIN is not saved.
3. Press **Check site**. It should say the form is as expected.
4. Import a report, or add one duty. Select only a night duty that has already ended, with a few
   activities so it has an interval that runs past midnight.
5. Press **F6**. The app fills the next entry. Read it, then click **Save Task** yourself.
6. Press **F6** for the following entries until you have saved the interval that runs past midnight
   and one that starts after it.
7. Open your Daily Logs on the site and check both entries: date, times and text.

If both are right, **F8** can do the rest. If a night entry shows under the wrong date or is
refused, use **Split at midnight** on that interval, or report it.

## Keys
| Key | Does |
|---|---|
| F6 | Fills the next entry and waits for you to click Save Task |
| F8 | Autopilot: previews the entries that will be saved, then asks to start. Press again to pause or resume |
| Esc | Stops |

The keys work only while the app is the active window.

**FX** switches the moving stars, scrolling text and screen lines on or off. If Windows has
animation effects turned off, the app starts with FX off.

## Speed
- **Instant** puts the text in at once. **Fast** and **Slow** type it at a steady pace.
- **Human** types the text one key at a time like a person: uneven gaps, short pauses after words,
  commas and sentences, and a moment before the date, start time and end time (those three are
  put in whole). It types about 55 words a minute, so a duty of nine entries takes two to three
  minutes plus the site's own loading. It makes no typing mistakes.

## Categories and entries
New duties belong to your section. When you add one, choose how its **Entries** are made.

- **Whole** is one entry from time in to time out. **Intervals** is several timed entries.
  Laboratory starts as Intervals, Nurse and Nurse Attendant as Whole; change each in **Settings**.
- To change a duty already in the list, open **Activities** and change **Entries**. The entries
  are written again, so text you typed in that duty is replaced.
- A whole entry's default times are 30 minutes before the shift to 15 minutes after. Change them
  to the times you actually came in and left.

**Nurse duties** use the wording of a ward diary entry, in capitals: log-in, endorsement received,
IVF, IV reinsertion and removal, nebulization, laboratory results, O2, medications, skin testing,
complaints, health teaching, admissions, discharges, endorsement to the next shift, log-out.
Type the number of patients for each. **A blank number leaves its sentence out; a typed 0 is
written as 0.** Put anything else under **Other tasks**; it is written as you type it. The wording,
including "CDH LOBBY", is editable in **Settings**.

**Nurse Attendant duties** are written in sentences starting with `*`, with the start time at the
front: log-in, patients received, three vital-sign rounds, specimen bottles and specimens, lab
requests and diet list, IVF and IV care, new admissions, patient requests, heplock, newborn
bathing, vital signs encoded, endorsement and log-out. Type the time of each vital-sign round
(for example 8pm) and the patient numbers; blank and 0 work as for Nurse. The endorsement to the
incoming shift is always written. In Intervals, check that each vital-sign round falls near the
time it names.

## Laboratory duties
- **Import** reads the CDH Accomplishment Report PDF, its JSON backup, or a CSV with the columns
  `Date, Shift, Hematology, ... Endorsement From, Endorsement To`. The CDH app's "Daily CSV" has
  no patient counts and cannot be used.
- In Intervals, each duty is written as: **time in**, **endorsement received**, timed intervals of work,
  **endorsement to the next shift**, and **time out**, each in 1-2 plain sentences. By default time
  in is 30 minutes before the shift, the handover 10 minutes, and time out 15 minutes after.
- The app shares the working time equally among the pieces of work, in this order: QC, new
  admissions (CBC, then chemistry and other tests), phlebotomy and hematology, chemistry,
  immunoassay and crossmatching, microscopy and serology, other tasks, routine tasks, then iHOMIS
  and cleaning. **These times are a proposal.** Change them to what you actually did, and use the
  times you actually came in and left.
- **Routine tasks** (supplies, reagents, analyzers, workstations, logbooks, results) are switches
  under **Activities**. They are off until you switch on the ones you did.
- **Write entries** writes a duty again with the next built-in phrasing and keeps the times. Text
  you typed yourself is left alone. **Rewrite** does the same for one entry. No online AI is used.
  Add your own phrasings in **Settings**, one on each line.
- Each patient count is written once. To spread one over intervals, open **Move or split
  activities**, type how many to move, choose the interval and press **Move**.
- New admissions name only the tests listed. With no tests listed, only the CBC is written.
- **Re-plan intervals** rebuilds a duty's times. Duties added in an earlier version keep their old
  entries until you press it, press **Write entries**, or change their activities.
- Wording saved by an earlier version is replaced by the new style.
- Counts are used exactly as imported or typed. Nothing is random.
- An entry cannot be sent before its end time has passed.

## When it stops
The app stops on a site error, a logout, a changed form, or when it cannot confirm a save. It
never presses Save a second time for the same entry without reading your logs first. Read the
message, fix the cause, and press F8 again: entries already on the site are skipped.

**Possible duplicate** means a logged entry may be this one (for example you changed its time
after saving). It is skipped unless you switch on **Send it anyway**.

**Not confirmed** means Save was pressed but the logs did not show the entry. Check your logs on
the site; switch on **Send it anyway** only if it is really missing.

**Night duties:** until the app has saved one entry after midnight and seen where the site lists
it, an after-midnight entry that matches an earlier night is shown as a possible duplicate. Check
the logs, then send it. After that first confirmed save the app knows.

Do not press Save, or open another page, while the app is typing. It will stop.

## Limits
- Import is for laboratory duties and is off in the other sections; their duties are added with
  **+ Duty**.
- It cannot edit or delete entries already on the site.
- Nobody has tried a whole entry that runs past midnight on the real site. Check the first one,
  or use Intervals for night duties.
- Built for Windows 7, 8, 8.1, 10 and 11. **Not tested on Windows 7 or 8.** Windows XP and Vista
  are not supported.
- The site uses plain `http`, so your PIN travels unencrypted. The app cannot change that.
- The built-in browser is from Electron 22 (needed for Windows 7/8) and gets no more security
  fixes, so it is locked to the diary site.

## Building
    npm install --omit=optional
    npm test
    npm run e2e:site        (clear ELECTRON_RUN_AS_NODE first)
    npm run e2e:app
    npm run build           → dist/ODWD-Autopilot-<version>.exe

On Node 24 Electron's installer may leave `node_modules/electron/dist` incomplete. Extract the
downloaded zip from `%LOCALAPPDATA%\electron\Cache` into that folder and write `electron.exe`
into `node_modules/electron/path.txt`.

The tests use a local imitation of the diary (`test/mock-site`). They never contact the real site.
