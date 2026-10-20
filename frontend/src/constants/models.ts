export interface SampleModel {
  id: string;
  name: string;
  url: string;
  description: string;
}

export const SAMPLE_MODELS: SampleModel[] = [
  {
    id: 'mechanical-engine',
    name: '2-Cylinder Engine',
    url: '/models/Mechanical_2CylinderEngine.glb',
    description: 'Mechanical 2-cylinder engine model.',
  },
  {
    id: 'mechanical-gearbox',
    name: 'Gearbox Assembly',
    url: '/models/Mechanical_GearboxAssy.glb',
    description: 'Mechanical gearbox assembly specimen.',
  },
  {
    id: 'ece-microcontroller',
    name: 'ECE Microcontroller Board',
    url: '/models/ECE_Microcontroller_Board.glb',
    description: 'Electronic microcontroller development board.',
  },
  {
    id: 'cse-motherboard',
    name: 'CSE PC Motherboard',
    url: '/models/CSE_PC_Motherboard.glb',
    description: 'Computer science & engineering PC motherboard.',
  },
];

export const DEFAULT_MODEL_URL = SAMPLE_MODELS[0].url;
