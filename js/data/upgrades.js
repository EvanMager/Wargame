/* Tech tree: spend Production to unlock unit variants and global bonuses.
   effect keys are read by the economy module when computing faction bonuses. */
(function (global) {
  'use strict';

  const UPGRADES = [
    {
      id: 'improved_logistics', name: 'Improved Logistics', category: 'logistics',
      cost: { production: 40 }, requires: null,
      effect: { logisticsRange: 2 },
      desc: '+2 supply range for all controlled regions.'
    },
    {
      id: 'production_boost', name: 'Industrial Mobilization', category: 'economy',
      cost: { production: 55 }, requires: null,
      effect: { productionMult: 0.15 },
      desc: '+15% Production output nationwide.'
    },
    {
      id: 'manpower_mobilization', name: 'Total Mobilization', category: 'economy',
      cost: { production: 45 }, requires: null,
      effect: { manpowerMult: 0.15 },
      desc: '+15% Manpower output nationwide.'
    },
    {
      id: 'fuel_efficiency', name: 'Fuel Efficiency Programs', category: 'economy',
      cost: { production: 45 }, requires: null,
      effect: { fuelUseMult: -0.20 },
      desc: '-20% fuel consumption for all mechanized/air/naval units.'
    },
    {
      id: 'heavy_armor', name: 'Heavy Tank Program', category: 'unit',
      cost: { production: 70 }, requires: null,
      unlocksUnit: 'heavy_armor',
      desc: 'Unlocks Heavy Armor: a much stronger, pricier tank variant.'
    },
    {
      id: 'jet_fighter', name: 'Jet Fighter Program', category: 'unit',
      cost: { production: 90 }, requires: 'improved_logistics',
      unlocksUnit: 'jet_fighter',
      desc: 'Unlocks Jet Fighters. Requires Improved Logistics first (fuel infrastructure).'
    },
    {
      id: 'advanced_artillery', name: 'Advanced Artillery Doctrine', category: 'unit',
      cost: { production: 50 }, requires: null,
      effect: { artillerySupportBonus: 0.15 },
      desc: 'Artillery support bonus increased by +15 percentage points.'
    },
    {
      id: 'elite_training', name: 'Elite Training Doctrine', category: 'morale',
      cost: { production: 60 }, requires: 'manpower_mobilization',
      effect: { moraleGainMult: 0.25, moraleFloor: 10 },
      desc: 'Units regain morale 25% faster and never fall below 10 morale while supplied.'
    }
  ];

  global.WWG = global.WWG || {};
  global.WWG.Data = global.WWG.Data || {};
  global.WWG.Data.UPGRADES = UPGRADES;
})(window);
