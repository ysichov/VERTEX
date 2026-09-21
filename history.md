# История разработок

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
