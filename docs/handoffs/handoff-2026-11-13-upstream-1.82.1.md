# Handoff — кабинет ДонБатона: апстрим 1.82.0 → 1.82.1 (13.11.2026)

Ветка `codex/upstream-1.82.1`, база — `684ccab7` (боевой 1.82.0 + форк + кнопка «Закрыть обращение»).
Слияние — `e3d77ecb`, правка теста — `0c65ff9c`. Предыдущий handoff — `handoff-2026-11-08-upstream-1.82.0.md`.
История тегов апстрима не переписана: `v1.82.0` — предок `v1.82.1`.

## Конфликт
- `src/components/subscription/manage/RecurringPanels.tsx` — апстрим передаёт тариф в панель CisPay через `cisPaySetupTariff` (вместо `canSetup`);
  обёртка форка `{!category && …}` сохранена: для Wi-Fi/LTE панели CisPay/СБП/Lava/Cashera не монтируются и ничего не запрашивают.
- Тест форка `networkCisPay.test.tsx` — подключение CisPay теперь прямо в панели (выбор периода + кнопка), ссылка `cispayRecurring.setup` убрана апстримом.

## Контракт с ботом
- **Только с ботом 5.2.1+**: POST `/cabinet/subscription/renew` шлёт `operation_id` и `expected_end_date` (`src/api/subscription.ts`,
  `src/utils/renewalOperation.ts` — идентификатор в localStorage, повтор/перезагрузка шлют тот же).
- Без загруженной `end_date` продление падает в браузере («Renewal requires a subscription snapshot»), запрос не уходит.
- Смена тарифа разрешена и при исчерпанном трафике (`is_limited`, срок не истёк) — окончательно решает бот.

## Проверки (мак, 13.11)
tsc 0, lint 0 (ошибок нет), vitest 2495/2495 (`--maxWorkers=4`; без ограничения — 3 таймаута под нагрузкой в нетронутых файлах), build 0 — бандл `index-DO0GkVsV.js`.
Образ — `donbaton/cabinet:u1821-0c65ff9c-20261113` (база `u1801-8c737a56-20261001` + `dist`).
