/* ================= Electro DAW | demoSeed.js ================= */
/* ---------------- demo seed ---------------- */
function seedDemo(){
  createPattern("Mélodie Piano");
  createPattern("Basse + Drums");

  // Pattern 1: Piano channel already exists
  project.activePatternId = project.patterns[0].id;

  // add Bass channel to pattern 1
  addChannelToPattern(project.patterns[0].id, "Bass", "#70a7ff");
  // switch to piano channel and add chords
  const p1=project.patterns[0];
  p1.activeChannelId = p1.channels.find(c=>c.preset==="Piano").id;
  const chP=p1.channels.find(c=>c.preset==="Piano");
  chP.mixOut = 1;
  const add=(ch,name,step,len,vel=100)=>{
    const m=nameToMidi(name);
    if(m==null) return;
    ch.notes.push({id:gid("note"),midi:m,step,len,vel,selected:false});
  };
  add(chP,"C4",0,4); add(chP,"E4",0,4); add(chP,"G4",0,4);
  add(chP,"C4",4,4);
  add(chP,"F4",8,4); add(chP,"A4",8,4); add(chP,"C5",8,4);
  add(chP,"G4",12,4); add(chP,"B4",12,4); add(chP,"D5",12,4);

  // Bass line same pattern
  const chB=p1.channels.find(c=>c.preset==="Bass");
  chB.mixOut = 2;
  add(chB,"C2",0,8,110);
  add(chB,"F1",8,8,110);

  // Pattern 2: default Piano channel -> change to Drums and add hats
  const p2=project.patterns[1];
  p2.channels[0].preset="Drums";
  p2.channels[0].name="DrumKit";
  p2.channels[0].color="#ff4d6d";
  // add Lead channel
  addChannelToPattern(p2.id,"Lead","#ff7b42");

  const chD=p2.channels.find(c=>c.preset==="Drums");
  chD.mixOut = 10;
  // hats: F# (pc=6) on 8th
  for(let s=0;s<32;s+=2){
    chD.notes.push({id:gid("note"),midi:nameToMidi("F#3"),step:s,len:1,vel:80,selected:false});
  }
  // kick C on beats
  [0,8,16,24].forEach(s=> chD.notes.push({id:gid("note"),midi:nameToMidi("C3"),step:s,len:1,vel:115,selected:false}));
  // snare D on 2&4
  [8,24].forEach(s=> chD.notes.push({id:gid("note"),midi:nameToMidi("D3"),step:s,len:1,vel:105,selected:false}));

  const chL=p2.channels.find(c=>c.preset==="Lead");
  chL.mixOut = 3;
  add(chL,"C5",0,2,95);
  add(chL,"D5",2,2,95);
  add(chL,"E5",4,4,95);
  add(chL,"G5",8,8,90);

  // playlist
  addTrack(); addTrack();
  const t1=project.playlist.tracks[0];
  const t2=project.playlist.tracks[1];

  t1.clips.push({id:gid("clip"),patternId:p1.id,startBar:0,lenBars:patternLengthBars(p1)});
  t1.clips.push({id:gid("clip"),patternId:p1.id,startBar:patternLengthBars(p1),lenBars:patternLengthBars(p1)});

  t2.clips.push({id:gid("clip"),patternId:p2.id,startBar:0,lenBars:patternLengthBars(p2)});
  t2.clips.push({id:gid("clip"),patternId:p2.id,startBar:patternLengthBars(p2),lenBars:patternLengthBars(p2)});
}
