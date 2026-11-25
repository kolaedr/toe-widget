# TOE Light

Віджет для iPhone ([Scriptable](https://apps.apple.com/app/scriptable/id1405459188)) з графіком погодинних відключень Тернопільобленерго, плюс статична сторінка встановлення на GitHub Pages.

Бекенд не потрібен. API `api-poweron.toe.com.ua` не віддає CORS-заголовків, тому сайт його не викликає. Усі запити робить сам скрипт: у `Request` у Scriptable немає CORS-обмежень.

## Як це працює

```
GitHub Pages (статика)                   iPhone
├─ index.html  ── інструкція ──────────▶ користувач
├─ toe-light.scriptable ── імпорт ─────▶ Scriptable: «TOE Light»
├─ toe-light.js ◀── самооновлення ─────┤   ├─ майстер: місто → вулиця → будинок (API TOE)
└─ version.json ◀── перевірка раз/6 год ┘   ├─ профіль у Keychain
                                            └─ віджет ── a_gpv_g ──▶ api-poweron.toe.com.ua
```

- **Персональні дані** (місто, вулиця, будинок, черга, тема, колір, сповіщення) зберігаються в Keychain на телефоні. У коді їх немає.
- **Загальні налаштування** зібрані в `APP` на початку `src/toe-light.js`: API, частота оновлення, сповіщення за замовчуванням.
- **Версія** — це хеш вихідного коду. Після пушу в `main` телефони оновлюються самі протягом ~6 годин. Вручну це можна зробити через меню скрипта → «Перевірити оновлення».

## Структура

```
src/toe-light.js          скрипт віджета (джерело)
web/index.html            сторінка встановлення
scripts/build.mjs         збирає dist/ (підставляє версію й BASE_URL, генерує .scriptable і version.json)
.github/workflows/pages.yml  збірка й деплой на Pages при пуші в main
```

## Деплой

1. Створи репозиторій `toe-widget` на GitHub і запуш цю папку в `main`.
2. **Settings → Pages → Source: GitHub Actions.**
3. Сайт буде доступний за адресою `https://<user>.github.io/toe-widget/`. `BASE_URL` для самооновлення workflow підставляє сам.

Локальна збірка:

```bash
node scripts/build.mjs                                     # BASE_URL за замовчуванням
BASE_URL=https://example.github.io/toe-widget/ node scripts/build.mjs
npx serve dist                                             # переглянути сторінку
```

## Можливості скрипта

- Малий, середній і великий віджет, а також віджети на екрані блокування (inline, rectangular, circular). Великий показує графік на сьогодні й завтра словами: «11:00–14:00 світла немає».
- Зворотний відлік («через 44 хв») малює сама iOS, тож він іде навіть тоді, коли віджет давно не оновлювався. Оновлення віджет просить кожні 15 хв або одразу після найближчої зміни стану, якщо вона раніше. Коли саме оновити, вирішує iOS.
- У віджеті показано час останньої синхронізації («оновлено 10:45»). Час публікації графіка TOE видно лише у великому віджеті.
- Тема: як у системі, світла або темна. Головний колір: пресет або свій HEX, підфарбовує фон і рядок з адресою.
- Сповіщення за 15, 30 чи 60 хв до відключення, або вимкнені.
- Посилання «Поділитися адресою»: `scriptable:///run/TOE%20Light?city=…&street=…&building=…&cityName=…&streetName=…`.
- Офлайн-кеш: якщо API недоступне, показується останній отриманий графік.

## API (неофіційне)

| Що | Запит |
|---|---|
| Пошук міст | `GET /api/pw_cities?pagination=false&name=<частина назви>` |
| Вулиці | `GET /api/pw_streets?pagination=false&city.id=<id>` |
| Будинки + черга | `GET /api/pw-accounts/building-names?cityId=&streetId=` → `buildingNames[].chergGpv` |
| Підчерга | `GET /api/pw-accounts/building-groups?cityId=&streetId=&buildingNames=` |
| Графік | `GET /api/a_gpv_g?before=0&after=0&group=<черга>&time=<cityId><streetId><будинок>` + заголовок `X-debug-key: base64("cityId/streetId/будинок")` |

Значення слотів у `dataJson[<черга>].times`: `"0"` — світло є, `"1"` — відключення, `"10"` — перемикання (можливо).
