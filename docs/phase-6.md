# Phase 6: Mission Planner, Dashboard, Commute, Map and Timeline Labs

Status: built and tested in headless Chromium at phone and laptop sizes. A real-device test is still to come (see [TESTING.md](TESTING.md)).

## What was built

1. **Phase calendar** from the exam profile: Foundation (now → 31 January of the exam year), Prelims focus (1 February → Prelims), Mains (the day after Prelims → Mains). Phase end dates are editable in **Settings → Exam profile**. Each phase weights Prelims against Mains work (Foundation 50/50, Prelims 85/15, Mains 10/90) and pauses atom groups: the Prelims phase pauses Mains-only atoms, the Mains phase pauses Prelims-only atoms. Paused atoms keep their history and come back when their phase returns.
2. **Daily Mission** on **Today**, built from today's time budget (**Settings → Daily time budget**, one number per weekday):
   - **Blocks:** warm-up reviews (capped), a Learn Loop on the top-priority topic, a PYQ elimination set, writing (sprints or one timed answer), the CA bridge, and a 5-minute close (misses waiting for a cause, plus tomorrow's preview).
   - **Topic priority:** P(n) = W(n) × (1 − R̄(n)) × (1 + 0.2·c(n)) × φ(n). W is the recency-weighted PYQ count (last five PYQ years × 1, older × 0.5) plus current-affairs heat; R̄ is the mean predicted recall of the topic's atoms on exam day (0 if unlearned); c is open confusion pairs (up to 5); φ is the phase factor.
   - **It is a suggestion:** each block has Start, Swap and Skip. Skipping asks why (tired, no time, not useful) and logs it. **Re-plan today** rebuilds it after you change the budget.
3. **Minimum viable day:** with 15–20 minutes the mission is reviews + 10 PYQ statements, which keeps the streak. A day counts when you do 10 statements and some reviews, or 15 active minutes. One missed day in any seven never resets the streak.
4. **Dashboard** (the **Progress** tab): days to each exam; the syllabus heatmap (each square a topic, colour = predicted recall on exam day, size = PYQ weight; tap to open); the exam-day forecast (% of Prelims atoms predicted at 80% recall or more); the five weakest high-weight topics with Learn Loop and Practice buttons; the calibration curve; the error-cause mix week by week; active ratio; recall speed; revisions per source; the mock trend with the projected band. Every chart has a **Show as a table** view.
5. **Weekly review** (`#/weekly`, prompted on Sunday, about 15 minutes): what moved this week against last, the five weakest high-weight topics, notes on plan changes, and a backup reminder.
6. **Commute mode** (**Labs → Commute**): one-thumb cards; tap to reveal, swipe right (had it) or left (missed). These are real reviews. Also **60-second true/false sprints** and **Listen mode**: the phone reads the prompt, waits 6 seconds, reads the answer, and you tap Know or Don't know. If the phone has no offline voice it says so plainly and tells you where to install one.
7. **Map Lab** (**Labs → Map Lab**): offline outline maps of India (official boundary) and the world, about 280 KB together. Atoms with a place (`geo: {lat, lon}`) become pins. Drills: **locate** (tap where it is; within 150 km counts), **identify** (name the pin) and **cluster** (four pins at once, tap each as it is named). Current-affairs places sit on a "news" layer. Map answers count as practice, not reviews.
8. **Timeline Lab** (**Labs → Timeline Lab**): drills on dated atoms: put four events in order, find the missing middle event, date → event, event → date. Also practice.
9. **Data health** (**More → Data health**): storage per store, persistent-storage status, the last export from each device, and an integrity check (orphans, items left by removed packs or older pack versions) with one-tap **Repair**, which never touches your event log.

The navigation is now **Today · Library · Labs · Progress · More**. Sources, Data (backup and packs), Data health and Settings are under **More**.

The demo now has a third pack, **Demo places and dates** (Data → Demo places and dates): 15 places with map pins and 10 dated history facts, so the Map and Timeline Labs can be tried.

## Decisions I made

| Question | Decision |
| --- | --- |
| Topics without PYQs | W gets a small floor (0.25) so such topics still rank by how much you have forgotten. |
| Budget under 20 minutes | Becomes the minimum day (reviews + 10 statements) rather than a squeezed full mission. |
| Streak | Counts real work (statements and reviews, or 15 active minutes), not just opening the app. |
| Map and Timeline answers | Practice only, so a geography drill never reschedules the underlying fact. |
| Chart colours | One validated palette for light and dark mode; the heatmap uses one blue scale; every chart has a table. |

## Known limitations

- Listen mode needs a text-to-speech voice on the device; most Android phones have an offline Google voice that can be downloaded in Settings.
- The forecast assumes you keep reviewing as scheduled; it is a guide, not a guarantee.
- Map outlines are simplified for size: fine for locating places, not for tracing borders.

## Fixes in the final pass (1.6.1 and 1.6.2)

- A screen could freeze on a card when this device's clock was behind the time of its last review (possible after syncing with a device whose clock runs fast). Fixed: the app now treats such a time as the moment of the last review.
- In the same situation, the notes writer kept reopening and lost what you typed. Fixed.
- Phone layout: chart date labels no longer overlap; chart tables scroll inside their card; the heatmap puts topic names above bigger squares; chip remove buttons are easier to tap.
