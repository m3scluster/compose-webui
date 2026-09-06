# Task-Projekt-Zuordnung

Dieses Dokument definiert den kanonischen Namen, den Parser und die
Validierungsregeln für Task-Daten der mesos-compose-API. Es ist die
Vertragsgrundlage für Frontend, API-Adapter und Tests.

## Fachliches Modell

Eine laufende Compose-Anwendung besteht aus einem Projekt und einem oder
mehreren Services. Ein Mesos-Task gehört fachlich genau zu einem
`frameworkname`, einem `projektname` und einem `taskname` (in mesos-compose ist
dies der Compose-Service-Name). Die technische `task_id` ist davon getrennt
und darf nicht in den kanonischen Namen eingebaut werden.

```text
TaskRef {
  framework: string
  project: string
  task: string       # Compose-Service, nicht task_id
  taskId?: string    # technische Mesos-Task-ID, falls vom API geliefert
}
```

`framework` ist der konfigurierte `PrefixTaskName` (standardmäßig der
Framework-Name). Die Zuordnung ist aus dem Task-Namen ableitbar; sie ist keine
zusätzliche, veränderliche UI-Zuordnung.

## Kanonisches Format

```text
<frameworkname>:<projektname>:<taskname>
```

Die Serialisierung ist exakt die Verkettung der drei Segmente mit zwei
Doppelpunkten. Jedes Segment ist verpflichtend und darf nicht leer sein.

### Erlaubte Zeichen

Für jedes Segment gilt die ASCII-Regel:

```text
[A-Za-z0-9][A-Za-z0-9._-]*
```

Damit sind Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich erlaubt;
der erste Buchstabe muss alphanumerisch sein. Nicht erlaubt sind Leerzeichen,
Unicode-Zeichen, Steuerzeichen, `/`, `\\`, `?`, `#`, `%`, `:` und sonstige
Sonderzeichen. Die Einschränkung verhindert zugleich mehrdeutige URL-Pfade,
Redis-Schlüssel und Shell-/CLI-Argumente.

Doppelpunkte sind reserviert und werden nicht escaped. Ein Segment mit einem
Doppelpunkt wird abgelehnt; es gibt keine alternative Escape-Syntax. Wer einen
Doppelpunkt im fachlichen Namen benötigt, muss ihn vor der Übergabe (z. B. in
`-` oder `_`) umbenennen.

### Eindeutigkeit

Bei gültigen Segmenten ist die Abbildung verlustfrei und eindeutig:

```text
parse(formatTaskName(f, p, t)) === { framework: f, project: p, task: t }
formatTaskName(...parse(name)) === name
```

Groß-/Kleinschreibung wird nicht normalisiert. Daher sind beispielsweise
`app:Web:api` und `app:web:api` unterschiedliche Namen. `task_id` bleibt ein
separates Feld und kann mehrere Instanzen desselben `(framework, project, task)`
haben.

## Parser- und Kompositionsvertrag

Die öffentliche Schnittstelle des Adapters soll mindestens diese Funktionen
anbieten:

- `parseTaskName(value, options?) -> TaskRef`
  - akzeptiert nur einen String;
  - gibt für den kanonischen Namen die drei Segmente zurück;
  - gibt für einen Legacy-Namen eine explizit als `legacy` markierte Zuordnung
    zurück (siehe unten);
  - wirft/returniert den definierten Validierungsfehler für einen als
    kanonisch erwarteten, aber ungültigen Namen.
- `formatTaskName({ framework, project, task }) -> string`
  - validiert alle drei Segmente;
  - erzeugt ausschließlich das kanonische Format;
  - erzeugt niemals einen Namen aus `task_id`.
- `validateTaskSegment(value, field) -> void | ValidationError`
  - prüft die obige ASCII-Regel und liefert den Feldnamen im Fehler.

Die konkrete Fehlerstrategie muss im Aufrufer einheitlich sein: intern darf der
Parser eine `ValidationError` werfen; an einer HTTP-Grenze wird sie als `400
Bad Request` mit einem stabilen Fehlercode serialisiert. Empfohlene Codes:
`TASK_NAME_NOT_STRING`, `TASK_NAME_SEGMENT_COUNT`, `TASK_NAME_EMPTY_SEGMENT`,
`TASK_NAME_INVALID_CHARACTERS`, `TASK_NAME_INVALID_SEGMENT_START` und
`TASK_NAME_LEGACY_UNSUPPORTED` (nur bei `strict: true`). Fehlermeldungen sollen
nie stillschweigend Segmente filtern oder trimmen.

`options.strict` ist standardmäßig `false`, damit das Lesen alter API-Daten
nicht bricht. Für neue Task-Erstellung und jede neue explizite Zuordnung ist
`strict: true` verpflichtend.

## Fehlende und zusätzliche Segmente

- `framework:project:task`: gültig.
- `framework:project`: bei strict ungültig (`TASK_NAME_SEGMENT_COUNT`).
- `project:task`: bei strict ungültig; die fehlende Framework-Komponente darf
  nicht geraten werden.
- `framework:project:task:extra`: ungültig; zusätzliche Segmente werden nicht
  zusammengelegt.
- `:project:task`, `framework::task`, `framework:project:`: ungültig;
  leere Segmente werden nicht ignoriert.
- `framework:project:task:name`: ungültig, auch wenn `name` scheinbar eine
  Task-ID wäre.

## Rückwärtskompatibilität

Bestehende Task-Namen ohne genau drei Segmente bleiben lesbar und operierbar.
Sie werden nicht rückwirkend umbenannt und erhalten keine erfundene
Projektzuordnung. Der Parser muss sie als Legacy kennzeichnen und den gesamten
Originalwert unverändert bewahren, zum Beispiel:

```js
parseTaskName('demo_web')
// { legacy: true, raw: 'demo_web', project: 'default', task: 'demo_web' }

parseTaskName('worker.123.0')
// { legacy: true, raw: 'worker.123.0', project: 'default', task: 'worker.123.0' }
```

Ein bestehender, bereits dreiteiliger Name wird kanonisch behandelt, sofern
alle Segmente die neue Zeichenregel erfüllen. Leere Segmente und ungültige
Zeichen bleiben auch beim Lesen erkennbar; sie dürfen im Legacy-Modus nicht
mittels `split(':').filter(Boolean)` verschleiert werden. UI-Aktionen für
Legacy-Daten verwenden weiterhin `task_id` für Task-Operationen; Projekt-/
Service-Aktionen dürfen bei fehlender verlässlicher Zuordnung nicht geraten
werden und müssen deaktiviert oder mit einem verständlichen Fehler abgewiesen
werden.

## Testmatrix

Positive Fälle:

```text
compose:billing:api
mesos-prod:project_1:web-v2
f:p:t
```

Für jeden positiven Fall gilt: Parse liefert exakt drei Segmente und Format
liefert byte-identischen Input.

Negative Fälle (strict):

```text
''
'compose:billing'
'billing:api'
'compose:billing:api:extra'
':billing:api'
'compose::api'
'compose:billing:'
'compose:billing:api name'
'compose:billing:api/name'
'compose:billing:äpi'
'compose:billing:.api'
```

Zusätzliche Kompositionsfehler:

```text
formatTaskName({ framework: '', project: 'p', task: 't' })
formatTaskName({ framework: 'f', project: 'p:p', task: 't' })
formatTaskName({ framework: 'f', project: 'p', task: 't#1' })
```

Jeder negative Fall muss einen stabilen Fehlercode liefern; keine Eingabe darf
stillschweigend normalisiert, gekürzt oder als gültige Zuordnung ausgegeben
werden. Legacy-Fälle (`demo_web`, `worker.123.0`) sind dagegen im Default-Modus
lesbar und müssen `legacy: true` sowie `raw` unverändert liefern.
