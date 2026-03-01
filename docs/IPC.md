# SLS IPC Contract (UI ⇄ JUCE Engine)

Protocol envelope:

```json
{ "v":1, "type":"req|res|evt", "op":"...", "id":"...", "ts": 0, "data":{} }
```

## Engine / Transport
- `engine.hello`
- `engine.ping`
- `engine.state.get`
- `engine.config.get`
- `engine.config.set` `{ sampleRate?, bufferSize?, numOut?, numIn? }`
- `transport.play`
- `transport.stop`
- `transport.seek` `{ ppq?:number, samplePos?:number }`
- `transport.setTempo` `{ bpm:number }`
- `transport.state.get`

## Project / Scheduling
- `project.sync` `{ ...projectSnapshot }`
- `schedule.clear`
- `schedule.setWindow` `{ fromPpq:number, toPpq:number }`
- `schedule.push` `{ events:[{ atPpq,type,instId,mixCh,note,vel,durPpq,...}] }`

## Instruments
- `inst.create` `{ instId,type }`
- `inst.param.set` `{ instId,params,juceSpec? }`
- `note.on` `{ instId,mixCh,note,vel|velocity }`
- `note.off` `{ instId,mixCh,note }`
- `note.allOff`

## Touski
- `touski.program.load` `{ instId,samples:[{note,path}] }`
- `touski.param.set` `{ instId, params }`
- `touski.note.on` `{ instId,note,mixCh,vel|velocity }`
- `touski.note.off` `{ instId,note,mixCh }`

## Mixer / FX / Meter
- `mixer.init` `{ channels:number }`
- `mixer.param.set` `{ scope:"master"|"ch", ch?, param, value }`
- `fx.chain.set` `{ target:{scope:"master"|"ch",ch?}, chain:[{id,type,enabled}] }`
- `fx.param.set` `{ target, id, params }`
- `fx.bypass.set` `{ target, id, bypass }`
- `meter.subscribe` `{ fps, channels:[-1,0,1,...] }`
- `meter.unsubscribe`

## Sampler
- `sampler.load` `{ sampleId,path }`
- `sampler.trigger` supports:
  - `mode:"vinyl"` => pitch ratio only
  - `mode:"fit_duration"` => fill duration exactly
  - `mode:"fit_duration_vinyl"` => fill duration + pitch

## Engine events
- `evt transport.state` `{ playing,bpm,ppq,samplePos }`
- `evt meter.level` `{ frames:[{ ch,rms:[L,R],peak:[L,R]}] }`
- `evt engine.state` (optional heartbeat)

## Error codes
- `E_UNKNOWN_OP`
- `E_BAD_REQUEST`
- `E_LOAD_FAIL`
- `E_NOT_LOADED`
- `E_NOT_FOUND`

No silent failures: every request gets an explicit `res` with `ok:true|false`.
