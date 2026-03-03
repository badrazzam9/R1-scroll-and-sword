export const NARRATIVE_EXAMPLES = [
  {
    theme: 'medieval',
    input: {
      objective: 'cross the gate',
      threat: 'shield guards',
      location: 'stone bridge',
      previousChoice: 'Set a trap and lure them in',
      step: 2,
      act: 1,
    },
    output: {
      narration: 'Your trap breaks the first shield line on the stone bridge. The remaining guards close rank at the gate chain and block the center path. Break through now or the portcullis will drop and trap you outside.',
      choices: ['Rush the chain guard', 'Climb side railing', 'Kick fire pot forward', 'Fall back and bait'],
      risk: 'mid',
      tag: 'combat',
      storyBeat: {
        objective: 'cross the gate',
        threat: 'shield guards holding a choke point',
        location: 'stone bridge gate',
        continuity: 'The trap worked, but the path is now tighter.',
      },
    },
  },
  {
    theme: 'noir',
    input: {
      objective: 'get out with the witness',
      threat: 'wiretap crew',
      location: 'service tunnel',
      previousChoice: 'Listen before acting',
      step: 4,
      act: 2,
    },
    output: {
      narration: 'In the service tunnel, your witness stumbles as a wiretap crew sweeps both exits with flashlights. Your last pause gave you route info, but also gave them time to flank. Move now and get out before they seal the shutters.',
      choices: ['Cut lights and sprint', 'Hit nearest flanker', 'Use side ladder route', 'Throw noise decoy'],
      risk: 'high',
      tag: 'hazard',
      storyBeat: {
        objective: 'get out with the witness',
        threat: 'wiretap crew flanking both exits',
        location: 'service tunnel',
        continuity: 'Waiting gave intel but cost positioning.',
      },
    },
  },
  {
    theme: 'scifi',
    input: {
      objective: 'stabilize the relay',
      threat: 'drone squad',
      location: 'relay hall',
      previousChoice: 'Use gear to bypass danger',
      step: 3,
      act: 1,
    },
    output: {
      narration: 'Your bypass tool opens the relay hall door, but a drone squad pivots to cover the console. Sparks jump from the floor grid and cut your safe path in half. Stabilize the relay fast or lose power to the whole section.',
      choices: ['Dash to console cover', 'EMP the drone lead', 'Cut floor grid power', 'Retreat to hatch'],
      risk: 'mid',
      tag: 'combat',
      storyBeat: {
        objective: 'stabilize the relay',
        threat: 'drone squad locking lanes',
        location: 'relay hall',
        continuity: 'Bypassing the lock triggered active defense.',
      },
    },
  }
];
