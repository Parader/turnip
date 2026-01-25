export const gameData = {
    classes: {
      assassin: {
        starterSpells: ['dash', 'backstab', 'poison_dagger', 'kick', 'trap'],
        baseStats: {
          movement: 6,
          energy: 6,
          offense: 7,
          meleeDefense: 3,
          magicDefense: 4,
          hp: 20
        }
      },
      warrior: {
        starterSpells: ['taunt', 'slash', 'heal', 'rage', 'spin'],
        baseStats: {
          movement: 4,
          energy: 5,
          offense: 8,
          meleeDefense: 6,
          magicDefense: 2,
          hp: 30
        }
      },
      archer: {
        starterSpells: ['shoot_arrow', 'stun_trap', 'raining_arrows', 'morale_boost', 'push_shot'],
        baseStats: {
          movement: 5,
          energy: 6,
          offense: 6,
          meleeDefense: 4,
          magicDefense: 3,
          hp: 22
        }
      },
      mage: {
        starterSpells: ['fireball', 'earth_block', 'heal', 'arcane_missile', 'teleportation'],
        baseStats: {
          movement: 3,
          energy: 7,
          offense: 5,
          meleeDefense: 2,
          magicDefense: 7,
          hp: 18
        }
      }
    }
  };