# SLS-IPC/1.0 (JSON Lines)

Transport: `stdin/stdout`, UTF-8, **1 JSON object per line**.

## Envelope (strict)

```json
{ "v":1, "type":"req|res|evt", "op":"string", "id":"string", "ts":0, "data":{} }
```

- `req`: JS -> engine
- `res`: engine -> JS (always answer a req)
- `evt`: engine -> JS push

## Standard response

```json
{ "v":1, "type":"res", "op":"same", "id":"same", "ts":0, "ok":true, "data":{} }
```

## Standard error

```json
{
  "v":1,
  "type":"res",
  "op":"same",
  "id":"same",
  "ts":0,
  "ok":false,
  "err":{"code":"E_CODE","message":"...","details":{}}
}
```

## Implemented (current)

- `engine.hello`
- `engine.ping`
- `engine.setConfig`
- `engine.getState`
- `transport.setTempo`
- `transport.play`
- `transport.stop`
- `transport.seek`
- `transport.getState`
- `midi.noteOn`
- `midi.noteOff`
- `midi.panic`
- `project.sync`
- `engine.state` (evt)
- `transport.state` (evt)
- `error.raised` (evt)

## Planned next (roadmap)

- Mixer control (`mixer.*`, `meter.update`)
- VST3 plugin lifecycle (`plugin.*`)
- Chunk transfer for large plugin states

## Hard rules

1. Every `req` gets exactly one `res` (`ok:true|false`).
2. No JSON parsing in JUCE audio callback.
3. `transport.stop` triggers internal panic / all notes off.
4. After `project.sync`, `transport.play` must produce audio immediately at `t=0`.
