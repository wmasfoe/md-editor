---
name: liquid-glass-ui-design
description: >
  Design and implement authentic Apple Liquid Glass UI and physics-based optical glass controls on the web.
  Covers multi-pass refractive shaders, SDF displacement maps, chromatic dispersion, specular highlight arcs,
  spring-physics transitions, and Apple HIG design principles for glass materials.
---

# Liquid Glass UI Design Skill

## 1. Core Principles (Apple HIG & Physics-Based Glass)

1. **Physical Authenticity**: Real glass bends light, refracts content, disperses RGB wavelengths at the contour, and reflects environment highlights. It is never just a flat translucent white rectangle or Gaussian blur.
2. **Hierarchy & Purpose**: Glass is for interactive controls, floating toolbars, and navigation chrome, not heavy text body backgrounds.
3. **Multi-Layer Optical Anatomy**:
   - **Layer 1: Ambient Track / Environment**: Soft translucent backing with high saturation boost (`saturate(180~200%)`).
   - **Layer 2: SDF Refraction Lens**: Physical coordinate displacement (`feDisplacementMap` / SDF shader) with RGB chromatic aberration.
   - **Layer 3: Specular Highlight Rim**: Top 1~1.5px pure white diamond highlight arc capturing directional ambient light.
   - **Layer 4: Interactive Floating Shadow**: Soft ambient contact shadow + deep floating elevation shadow when lifted/dragged.
4. **Motion & Fluid Interaction**:
   - Motion uses Apple fluid deceleration curves (`cubic-bezier(0.16, 1, 0.3, 1)` or underdamped springs).
   - Touch/drag lifts the glass droplet with subtle scale (`1.02~1.04x`) and deeper elevation shadow.
   - Transitions glide smoothly between discrete anchor positions rather than jumping.
