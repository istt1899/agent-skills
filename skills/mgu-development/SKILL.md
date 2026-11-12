---
name: mgu-development
description: Разработка, аудит и публикация приложений для BMW MGU (iDrive 7, G01 и совместимые): паспорт платформы, mgu-deploy/mgu-updater, cluster-render/mgu-render, SOME/IP GPS-мост, HSFZ-диагностика ECU, правила read-only и публикации только через istt1899/x3. Использовать для задач про MGU, iDrive 7, «Стрелку», RideTube, Waze on Cluster, Bimmer Code и диагностику блоков.
metadata:
  version: "1.0.0"
---

# MGU Development Skill — BMW X3 (G01) / iDrive 7 (MGU)

Версия 1.0, собран по результатам живого read-only аудита 12.11.2026 (сессия car-x3/2026-11-12T0915Z).
Автомобиль: BMW X3 G01. Все факты ниже подтверждены наблюдением на этой машине, если не указано иное.

---

## 0. Жёсткие правила безопасности (нарушать нельзя)

1. **Только read-only на автомобиле**, пока владелец явно не попросил изменение. Запрещены: flash, кодирование, очистка DTC, SecurityAccess, UDS-сервисы 0x2E/0x2F/0x31, eCall, remote-команды (запуск/блокировка/сигнал), `mgu-deploy status`, запуск Store updater, запуск `check.js` приложений без предварительного разбора кода.
2. **Идентичность машины на каждую сессию**: host key SSH MGU перегенерируется при каждой загрузке (в /etc/ssh нет файлов ключей) — known_hosts между ребутами бессмысленен. Порядок: сначала read-only VIN через HSFZ (см. §7), сверить с ожидаемым, только потом `ssh-keygen -R <ip> -f <known_hosts>` и accept-new. Не принимать ключ вслепую.
3. **Секреты и VIN не выводить в открытые отчёты.** Файлы аккаунтов/proxy читать только как masked metadata (наличие, размер, дата), не содержательно.
4. Статусы честные: pass / partial / blocked / not_run. Не выдумывать PASS. Описания DTC без декодера не сочинять.
5. **Публикация обновлений — только в `istt1899/x3`** (GitHub Releases, общий релиз `catalog`). При обновлении одного компонента сохранять остальные записи общего каталога (версии, зависимости, URL, хэши). Старый репозиторий `istt1899/bmw-kaluga-cameras` — не место публикаций. Runtime-адреса данных (манифесты баз) переносить отдельной задачей с проверкой; замена каталога ≠ перенос runtime-адреса.

---

## 1. Паспорт платформы MGU (подтверждено)

- ОС: **P18_23w03.3-1-5 (mgu-high)**, kernel 4.14.198-apl x86_64, 4 CPU, 5.7 GB RAM.
- Runtimes: системный **Node v8.16.2** (ABI 57, OpenSSL 1.1.1s) — штатные приложения BMW и старые сервисы; **jap-node22 22.23.4** (`/var/opt/jap-node22/current/bin/node`) для новых фоновых сервисов; **python3** через mgu-python (`/var/opt/mgu-python/current/bin/python3`).
- ФС: `/` read-only; **`/var/opt` rw** — весь пользовательский софт тут; ecryptfs на /var/opt/public|personal. Временные сокеты: `/dev/shm/`.
- BusyBox-ограничения: `ps` без опций, нет `ss`, нет `python3` системного; есть systemctl, journalctl, netstat, sqlite3, sha256sum. `timeout` может отсутствовать.
- **journald volatile**: `--list-boots` показывает только текущую загрузку; логи не переживают reboot — диагностику прошлых инцидентов по журналу восстановить нельзя.
- При загрузке часы стартуют с 2023-01-18 и синхронизируются позже — не путаться в `Active: since 2023` у units.
- ICMP к MGU закрыт — ping не является проверкой доступности.
- SSH: `ssh -i <enrollment>/id_rsa -o UserKnownHostsFile=<сессионный> root@169.254.247.65`. Ноутбук на ENET: 169.254.234.88.

## 2. Экосистема приложений (mgu-deploy / mgu-updater)

- Всё ставится пакетами в `/var/opt/<id>/versions/<ver>/` с symlink `current → versions/<ver>`. Состояние: `/var/opt/<id>/data|state|log`.
- **component.json** — манифест: id, kind (app|tool), version, requires (минимальные версии зависимостей), files со sha256, units (systemd), enable-таргеты, recmgr, uids, internet:true/false, mguHmi (ID7/ID8).
- `mgu-updater` (daemon) тянет каталоги из sources (`/var/opt/mgu-updater/sources.json`): builtin mgu-store, idrive-apps, idrive7-apps, car-apps, плюс источник владельца **`istt1899/x3`**. Provenance установленного: `/var/opt/mgu-updater/state/origins.json`.
- Ловушка: на машине жили stale tinyurl-источники (s-01b6/s-05c6) со старыми каталогами — обновление может прийти не из x3. Проверять origins после каждого обновления.
- `mgu-updater/state/boot.json` — per-boot состояние (`hidden` тайлы действуют только до следующей загрузки; сравнивать boot id).
- `mgu-deploy` регистрирует apps в HMI (`/var/opt/mgu-deploy/state.json`, uid 12xxx для apps). HMI-приложения — JS-бандлы на oap-sdk, работают внутри HMI; приложение может удерживаться активным в фоне собственной логикой (пример: GPS-мост «Стрелки» держит апп через shouldHold()).
- Сервисные units создаются пакетами; drop-in `zz-mgu-deploy-limits.conf` добавляет лимиты. systemd показывает 0 failed при здоровой системе.

## 3. Рендеринг и вывод

- **mgu-render 0.6.19** — экраны приложений на GPU (центральный дисплей). Сервисы `mgu-render.service`, `mgu-render-hmi.service`.
- **cluster-render 0.5.5** — слои на приборной панели и HUD: canvas 800×480, слоты/арбитраж «holder», общий upload-бюджет. Приложения получают слой через клиентский контракт (пример: `cluster_render_client.js` в marku-kaluga-cameras). Состояния слоя: shown/скрыт/отказ (reason: CANVAS_UNKNOWN, CANVAS_TOO_SMALL, NO_ACTIVE_ALERT…).
- **mgu-inputgate 1.0.0** — ввод (iDrive controller/touch) для приложений.
- Геометрия карточек верифицируется renderer'ом: «подписка на сцену» ≠ физическая видимость — в статусах различать verified/unobservable (это исправлено в Стрелке 0.8.1).

## 4. IPC-паттерн: control-socket

- Демон слушает Unix-сокет `/dev/shm/<app>/ctl.sock`, протокол **JSONL** (один JSON на строку, лимит строки 8192 B, буфер 128 KB).
- На подключение сервер сразу шлёт полный state (`{"ev":"status","state":{...}}`) — **read-only статус получается простым connect+read, без команд**.
- Команды приложения→демон: `status`, `enable/disable`, `alert-preferences`, `overspeed-preferences`, `outputs`, `hud-opacity`, `card-move`, `display-test`, `audio-test`, `database-check`, `gps-reset`, `vehicle-nmea`, `gps-bridge`, `vehicle-context`. Команды с requestId получают commandResult с фазами requested/finished/error.

## 5. SOME/IP из HMI-приложений (подтверждённый канал к данным автомобиля)

- SDK: `oap-sdk/src/someip/someipBuilders` — `buildAndInitTypedProxy(INTERFACE, INSTANCE, {timeoutMs})` либо `buildTypedProxy` + `init()` + `waitUntilAvailable()`.
- **Подтверждён работающим: `de.bmw.infotainment.SatellitePositioning` (instance "1")**, событие `updatePosition.subscribe(payload => …)`, payload.nmeaString — сырой NMEA (RMC/GGA/GST/GSV/GNS/VTG/GSA/GBS/GRS + проприетарные XFI). Это источник GPS/скорости/курса/точности/UTC автомобиля.
- Навигационный интерфейс (название улицы) подключён в Стрелке (bmw_navigation_bridge.js), но данных пока не даёт — не считать рабочим.
- Недоказанные интерфейсы/методы не вызывать «по имени» — только после подтверждения контракта.
- Паттерн моста: HMI-апп подписывается на SOME/IP и пересылает кадры демону через `vehicle-nmea` в ctl.sock. Поток ограничивать (writableLength ≤ 16 KB), не переотправлять буферизованные координаты, retry с экспоненциальной задержкой и лимитом попыток.
- **Риск архитектуры**: мост живёт в HMI-приложении — после reboot без открытия аппа данных нет (проверка холодного автозапуска — открытая задача).

## 6. GPS-контракт «Стрелки» (как образец строгой валидации входа)

- BMW и внешний NMEA — раздельные декодеры, части предложений не смешиваются.
- Парность: RMC+GGA в пределах 500 мс по UTC, GST+GGA в пределах 100 мс; координаты RMC/GGA не дальше 50 м; accuracy ≤ 15 м (GST), checksum обязателен; возраст фикса ≤ 3 с, future-допуск 500 мс; RMC со статусом invalid/simulated отбрасывается.
- roadReady (0.8.1): speedKmh ≥ 0, heading 0–360, accuracy 0–15 м. motionFixes — отдельный «слабый» контур для определения стоянки.
- GPSD (127.0.0.1:2947) и внешний UDP NMEA (127.0.0.1:5001) — опциональные входы; на машине их нет (ECONNREFUSED — норма).
- Алерты только в движении: на стоянке guidance=none/WAITING_MOTION, карточка скрыта (NO_ACTIVE_ALERT) — это контракт, не дефект.
- **Звук: НЕ реализован** в 0.8.0/0.8.1 — warning-audio.js требует внешний adapter с `.play()`, который никто не передаёт; audioTest = AUDIO_UNAVAILABLE. Перед заявлением «звук поддержан» обязателен подтверждённый BMW playback-канал (ST-09) и тест слышимости на стоянке.
- Версии: установлена 0.8.0 (из stale tinyurl s-05c6 — см. §2 ловушку); в istt1899/x3 опубликована 0.8.1 (GPS motion-улучшения, честные статусы renderer; звук по-прежнему отсутствует).

## 7. Диагностический контур ECU (HSFZ)

- Транспорт: **HSFZ (не DoIP)**, TCP `169.254.6.68:6801` (диагностический шлюз ENET).
- Кадр запроса: `struct.pack(">IHBB", 2+len(uds), 0x0001, 0xF4, dst) + uds`. Ответ: 4B len, 2B ctrl (0x0001=ответ, 0x0002=ack), payload = src, dst, uds. `7F xx 78` = response pending — перечитывать.
- Подтверждённые read-запросы: `22 F1 90` (VIN) со всех 28 блоков SVT; `19 02 AF` (DTC snapshot). 
- Топология: 28/28 блоков отвечают. Особенности: GWS2 — пустой VIN (норма); HKFM2/ZBE4 — нули (норма); BDC_BODY3 — NRC 0x21 (busy, повторять); DSC_VIP2/LMV3 — NRC 0x31 (VIN не хранится); ATM2 (0x61) жив, SWFL 00004A53.015.003.042; ICAM3 после инцидента 03.11 отвечает.
- DTC-снимок 12.11: 63 DTC в 11 блоках; ATM2: 03178A/031786 активные (0x2F); BDC_GW3: 34 (масса CD04xx — Ethernet-коммуникация); HU_MGU 5, DME 6, DSC_VIP2 4, USS 3. Расшифровки нет — нужен декодер/E-SYS на ПК.
- ATM: удалённые функции (запуск и пр.) идут через облако ConnectedDrive; локального command API не найдено; ConnectedDrive uplink наблюдаем как vlan77 (160.48.199.225, маршруты к AWS). Интернет приложений — отдельно: mgu-uplink (wlan0, тетеринг телефона 172.20.10.12/28, lease в `/run/mgu-uplink/lease.json`).

## 8. Медиа (RideTube / VK / RUTUBE)

- Служба `jap-ridetube-d 0.4.5` (Node 8 main + helpers: python ytfetch.py, node22 thumb.js, ytdlp.pyz, ffmpeg в runtime/). Провайдеры: **youtube, vk, rutube**; один плеер-владелец (DaemonPlayer), три app-сокета.
- Сеть: `state/network.json` `{"source":"external"}` → через mgu-uplink (`/run/mgu-uplink/lease.json`); builtin-режим — альтернатива.
- YouTube по каталогу — «через прежний прокси»: **без state/proxy.json и state/account.json YouTube не работает** (текущее состояние машины). VK/RUTUBE идут напрямую, аккаунты есть.
- Картинка только на стоянке (podcast-режим в движении) — контракт приложения.

## 9. Прочие установленные компоненты

- waze-on-cluster 0.9.13: root-helper patchd (обратимые патчи carplay/aapd), capture декодирует H.264 карты CarPlay/AA → cluster-render; recovery/journal/dlt_capture процессы.
- app-privacy 1.7.1, iteriodev-comfort 0.5.1, idrive7-renderd 2.1.11, brake_test, car_vitals, dtc_scanner, dyno, gforce, live_data, redline, service, warmup, zf8hp, draggy (idrive-apps ecosystem).
- **marku_x3_coding 0.2.0 («Bimmer Code для MGU Store»)**: каталог 10 функций + read-only обнаружение ECU; **запись кодировок НЕ реализована**. Диагностику запускать только на стоянке.
- marku_kaluga_cameras 0.8.0 (HMI-апп Стрелки), marku_rutube 0.1.8, marku_vk_video 0.1.8 (отдельные UI к общей службе).

## 10. Рецепты для агента-разработчика

**Новое приложение/сервис:**
1. Пакет: `/var/opt`-layout, component.json с sha256 всех файлов, systemd units (multi-user/sockets target), recmgr-имя, uid из пула, internet:true только если реально нужен.
2. Node 8-синтаксис для демонов на системном интерпретаторе (var, без optional chaining) либо явно jap-node22.
3. Состояние в `/var/opt/<id>/data` с атомарной записью и durability-отчётом; настройки не терять при сбое хранилища (помечать settingsSaved=false).
4. UI: mgu-render (центр) + cluster_render_client (приборка/HUD) + mgu-inputgate (ввод). Слои отдавать с target/verifiable статусами.
5. Публикация: собрать tgz → проверить reader'ом mgu-updater → релиз в istt1899/x3, сохранив остальной каталог → проверить origins на машине после установки.

**Диагностическая сессия:**
1. VIN через HSFZ → ssh accept-new → baseline (date -u, uptime, boot_id, uname, systemctl --failed, /proc/meminfo, listeners) → только потом симптомы.
2. Каждую команду логировать (имя, команда, exit, stdout) в сессионную папку `output/bmw-diagnostics/<car_id>/<session>/`.
3. Live-статус сервисов — через их ctl.sock (connect+read), не через недоказанные helpers.
4. Динамику (движение/скорость) не имитировать на проде: граничные случаи — на офлайн-копии пакета на ПК (все тесты ST-04–08/12/13).

**Отчётность:** findings (ранжированные, с первой доказанной стадией отказа), coverage по требованиям, отчёт владельцу по-русски: что работает / что отказало / что не реализовано / что не проверялось. Без гарантий по одному успешному тесту.
