# История разработок

## 2026-09-23 — VERTEX 0.6.9: провайдеры, модели и окно со своей системой

- Провайдеры названы по тому, за что платят: «Claude subscription (Claude Code)», «ChatGPT
  subscription (Codex)», «Anthropic API (key)»; в панели — короткие Claude / ChatGPT / Anthropic API.
  В документации сказано, что подписка работает только через установленное расширение вендора.
- LLM Providers: таблица моделей для каждого провайдера с чекбоксами, не меньше одной включённой.
  Для подписки Claude — список версий по полному id (`CLAUDE_VERSIONS`), по умолчанию включена
  новейшая модель каждого семейства; другой id добавляется после проверочного запроса. Anthropic
  API берёт список из `GET /v1/models`. Без выбора используется самая слабая включённая модель.
- Панель VERTEX: сверху ссылки SAP system и LLM Providers, внизу закреплены провайдер, модель,
  New conversation, поле ввода и кнопка VERTEX Tools с логотипом; Review & save убрана (есть в
  контекстном меню).
- Окно VERTEX Tools хранит систему, на которой открыто, и называется по ней («VERTEX E19»); чат
  окна Ask AI со сплиттером и крестиком, провайдер и модель общие с панелью.
- Главный чат обращается к любой системе из `vertex.systems`, если она названа в вопросе:
  перенос кода — чтение в одной системе и черновик в другой через Code Change reviewer.
- Сплиттеры и сворачивание Parts в Versions, Code Explorer и View source.
- Versions разложен как в AVE: слева Parts и под ними список версий выбранной части (со
  сплиттером по высоте), справа diff. Любую версию можно закрепить как базу (◇) и сравнивать
  с ней остальные; Diff prev возвращает сравнение с предыдущей версией.
- Исправлено: ответ «Opened … in system» показывал ключ подключения вместо имени системы.

## 2026-09-21 — VERTEX 0.6.0: source as navigation

- View source now uses the Diff Parts table: `CPUB` / `CPRO` / `CPRI`, `METH`, and SE80-style
  visibility markers. A class method moves between its declaration and body; a section positions
  its declaration.
- Programs remain fully visible: the events, FORM, and local-class list only scrolls the complete
  source to the selected block.
- View source gained Back; a selected fragment and method signature are passed to VERTEX chat.
  A redefinition signature is resolved through its inheritance chain.
- In both VS Code chats, Enter sends a request and Ctrl+Enter adds a line; the separate Send button
  is gone.

## 2026-09-14 — VERTEX 0.5.4: чат и чтение SAP-кода через ADT

- Перенесены в расширение VS Code операции поиска и чтения программ, глобальных классов и функциональных модулей SAP.
- В интерфейсе оставлен свободный чат; SAP-инструменты вызываются его оркестратором. SelecTor, Metrics и Versions сохранены как прежние быстрые запуски.
- Создание и изменение объектов готовят черновик и diff. Запись в SAP выполняется только после проверки и явного применения черновика.
- Ключи и пароли не записываются в проект: пароль системы хранится в VS Code SecretStorage, настройки систем находятся в `vertex.systems`.
- Причина ошибки `certificate has expired`: клиент `abap-adt-api` использовал собственный Axios-транспорт, а настройки TLS VS Code не совпадали с прямым запросом к SAP. Работающий ADT подтвердил доступность системы.
- Добавлен явный `sap-http.js`: он выполняет запросы напрямую к настроенному SAP-хосту и передаёт `rejectUnauthorized: false`, когда для системы включено `allowInsecureCertificate: true`.
- Проверка на `https://sap.example.com:44300`: при разрешённом сертификате TLS проходит и сервер отвечает HTTP 401 без пароля; при строгой проверке воспроизводится `CERT_HAS_EXPIRED`.
- Собран пакет [vertex-abap-0.5.4.vsix](vscode/vertex-abap-0.5.4.vsix). Тесты ADT и рабочей области проходят.
