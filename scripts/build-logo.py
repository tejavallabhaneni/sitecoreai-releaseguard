# Generates public/branding/releaseguard-logo.svg (tile) and releaseguard-mark.svg (shield only).
# Run from the repo root: python3 scripts/build-logo.py, then re-render the PNGs.
import math
SHIELD = "M256 80 C302 100 350 114 398 122 C403 126 405 131 405 138 V246 C405 340 342 404 256 440 C170 404 107 340 107 246 V138 C107 131 109 126 114 122 C162 114 210 100 256 80 Z"
RIGHT = "M256 80 C302 100 350 114 398 122 C403 126 405 131 405 138 V246 C405 340 342 404 256 440 Z"
def check_arrow(color, sw=38, off=(-8,6)):
    ox,oy=off
    a=(176+ox,268+oy); b=(230+ox,321+oy); tip=(342+ox,208+oy)
    dx,dy=tip[0]-b[0],tip[1]-b[1]; L=math.hypot(dx,dy); ux,uy=dx/L,dy/L; px,py=-uy,ux
    hl,hw=60,45
    base=(tip[0]-ux*hl,tip[1]-uy*hl); se=(tip[0]-ux*(hl-8),tip[1]-uy*(hl-8))
    tri=[(tip[0]+ux*5,tip[1]+uy*5),(base[0]+px*hw,base[1]+py*hw),(base[0]-px*hw,base[1]-py*hw)]
    t=" ".join(f"{x:.1f},{y:.1f}" for x,y in tri)
    return (f'<path d="M{a[0]} {a[1]} L{b[0]} {b[1]} L{se[0]:.1f} {se[1]:.1f}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<polygon points="{t}" fill="{color}" stroke="{color}" stroke-width="10" stroke-linejoin="round"/>')
DEFS='''<defs>
<linearGradient id="navy" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#211D52"/><stop offset="1" stop-color="#0C0A26"/></linearGradient>
<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#6B55FF" stop-opacity="0.55"/><stop offset="1" stop-color="#6B55FF" stop-opacity="0"/></radialGradient>
<linearGradient id="shield" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8C76FF"/><stop offset="0.55" stop-color="#5440E6"/><stop offset="1" stop-color="#2E22A6"/></linearGradient>
<radialGradient id="gloss" cx="0.25" cy="0.12" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.30"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<linearGradient id="mint" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#12BD8B"/><stop offset="1" stop-color="#7AFAD4"/></linearGradient>
<linearGradient id="edge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0.05"/></linearGradient>
<filter id="sh" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.45"/></filter>
<filter id="mg" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#062E22" flood-opacity="0.45"/></filter>
</defs>'''
def logo(tile=True):
    body = ''
    if tile: body += '<rect width="512" height="512" rx="116" fill="url(#navy)"/><circle cx="256" cy="262" r="230" fill="url(#halo)"/>'
    body += (f'<g filter="url(#sh)"><path d="{SHIELD}" fill="url(#shield)"/></g>'
             f'<path d="{RIGHT}" fill="#0A0730" fill-opacity="0.18"/>'
             f'<path d="{SHIELD}" fill="url(#gloss)"/>'
             f'<path d="{SHIELD}" fill="none" stroke="url(#edge)" stroke-width="4" stroke-linejoin="round"/>'
             f'<g filter="url(#mg)">{check_arrow("url(#mint)")}</g>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{DEFS}{body}</svg>'
open("public/branding/releaseguard-logo.svg","w").write(logo(True))
open("public/branding/releaseguard-mark.svg","w").write(logo(False))
