# Project Blueprint: Kernel Panic (Phase 1)

## 1. Vision Statement
A tactical, purely turn-based roguelike inspired by *Neuromancer* and classic 80s cyberpunk. The game emphasizes resource management, social standing (Vouching), and the high-stakes duality of physical and digital survival.

## 2. Core Pillars
* **Dual-Map Systems:** Meatspace (Physical) and Cyberspace (The Matrix) exist as layered grids.
* **Total Vulnerability:** Your physical body is a "vegetable" while you are jacked into the Matrix.
* **Tactical Grid Combat:** Purely turn-based movement and action.
* **The Rep System:** Social capital as a primary progression mechanic and tactical advantage.
* **ASCII-Plus Aesthetic:** A modern "terminal" look using ASCII characters with high-fidelity effects.

## 3. Player Archetypes (Phase 1)
| Archetype | Focus | Primary Tool | Key Perk |
| :--- | :--- | :--- | :--- |
| **The Merc** | Ranged Combat | Kinetic Carbine | **Vault:** Hop over cover while firing. |
| **The Razor** | Melee & Stealth | Monofilament Blade | **Slide:** Low-profile dash to avoid fire. |

## 4. The World Layers

### Meatspace (Physical)
* **Environment:** Industrial sectors, neon slums, corporate arcologies.
* **Threats:** Corp-Sec Drones and Enforcers.
* **Navigation:** Tactical cover, line-of-sight, and noise management.

### Cyberspace (The Matrix)
* **Environment:** Graph-based nodes and logic pathways.
* **Threats:** Intrusion Countermeasure Electronics (ICE) - Probes, Sparks, and Guardians.
* **Mechanic:** Real-time "CCTV" (PIP window) showing your physical body's status.

## 5. Technical Mechanics (Phase 1)
* **Grid:** 2D Array-based world state.
* **Action Points (AP):** * Move: 1 AP
    * Attack: 2 AP (Ranged) / 1 AP (Melee)
    * Interact: 1 AP
* **A* Pathfinding:** Drones calculate shortest paths based on current wall/floor states.
* **Destruction:** Rare breaching tools (e.g., Thermal Paste) create persistent map changes.
* **Persistence:** The map state is saved during a run; holes you blow in walls stay there for the backtrack.

## 6. Social & Economy
* **The Rep Meter:** Increases by completing community-focused tasks. Higher Rep levels turn neutral NPCs into "Human Shields" or information sources.
* **Credits:** The primary currency in V1. Used for ammo, medical stims, and permanent RAM upgrades.

## 7. The Terminal UI
* **Main View:** The ASCII Grid with a CRT/scanline filter.
* **Sidebar:** Real-time diagnostics (BIO_INTEGRITY, SYSTEM_RAM, NETWORK_TRUST).
* **Bottom Log:** Narrative and tactical feed (e.g., `> SYSTEM ALERT: INTRUDER DETECTED`).

## 8. Development Roadmap

### Phase 1: Meatspace MVP
* Basic combat and movement for Merc/Razor.
* A* drone pathfinding and Line-of-Sight.
* The "Safe House" Hub and the Curator (Quest-giver).
* Death Screen: Terminal Crash Dump.

### Phase 2: Deepening Meatspace

* Campaign system: crew management, multi-run progression, new PC class (Tech).
* Salvage economy & Finn, the gear broker.
* Rep system / social groundwork.

### Phase 3: Ghost in the Machine
* The Jack-in mechanic and layered Matrix grid.
* ICE AI and Cyberspace nodes.
* The CCTV PIP Window.

### Phase 4: The Social Fabric
* Reputation-based NPC interactions.
* Advanced breaching tools.
* Dynamic "Rep" zones.

### Phase 5: Meta-Progression
* Neural Backups (Legacy Data).
* Permanent base upgrades.
* Diverse biomes (Arcologies, Data Havens).
