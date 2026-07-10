#!/usr/bin/env python3
"""Generiert lokalisierte Store-Screenshot-Mockups (HTML) fuer das Aionda-Mail-Addon.

Die UI-Texte kommen 1:1 aus _locales/<lang>/messages.json. OS-/Browser-Texte
(Kontextmenue, Beispiel-Anmeldeseite) sind unten im OS-Dict pro Sprache gepflegt.

Usage:
    python3 gen_screenshots.py            # HTML nach ./out/screens/
    node render_screenshots.cjs            # rendert PNGs (1280x800) nach ./out/screens/png/<lang>/

Ergebnis danach nach src/docs/trashmail-addons/chrome/<lang>/webstore/ kopieren.
"""
import json, os, html

HERE = os.path.dirname(os.path.abspath(__file__))
ADDON = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out', 'screens')
LOGO = f'file://{ADDON}/images/menu@1x.png'
LANGS = ['de', 'en', 'fr', 'es', 'pt', 'br']

os.makedirs(OUT, exist_ok=True)

# ---- OS-/Seiten-Texte (nicht im Addon lokalisiert) ----
OS = {
    'de': dict(emoji='Emojis &amp; Symbole', undo='Rückgängig', redo='Wiederholen', cut='Ausschneiden',
               copy='Kopieren', paste='Einfügen', pastematch='Einsetzen und Stil anpassen',
               selectall='Alles auswählen', writedir='Schreibrichtung', inspect='Untersuchen',
               autofill='Automatisch ausfüllen',
               heading='Deine Anmeldedaten', email='E-Mail', password='Passwort', signup='Kostenlos registrieren',
               legal='Es gelten unsere Nutzungsbedingungen. Informationen zur Verarbeitung deiner Daten findest du in unserer Datenschutzerklärung.',
               col1='Sicherheit|Hilfe|Kontakt', col2='Impressum|Datenschutz|AGB',
               newsletter='Ja, ich möchte über Neuigkeiten und Angebote per E-Mail informiert werden. Eine Abmeldung ist jederzeit möglich.'),
    'en': dict(emoji='Emoji &amp; Symbols', undo='Undo', redo='Redo', cut='Cut',
               copy='Copy', paste='Paste', pastematch='Paste and Match Style',
               selectall='Select All', writedir='Writing Direction', inspect='Inspect',
               autofill='Autofill',
               heading='Your login details', email='Email', password='Password', signup='Sign up for free',
               legal='Our terms of service apply. For details on how we process your data, see our privacy policy.',
               col1='Security|Help|Contact', col2='Legal notice|Privacy|Terms',
               newsletter='Yes, I would like to receive news and offers by email. I can unsubscribe at any time.'),
    'fr': dict(emoji='Émojis et symboles', undo='Annuler', redo='Rétablir', cut='Couper',
               copy='Copier', paste='Coller', pastematch='Coller et adapter le style',
               selectall='Tout sélectionner', writedir='Sens de l’écriture', inspect='Inspecter',
               autofill='Remplissage automatique',
               heading='Vos identifiants', email='E-mail', password='Mot de passe', signup='S’inscrire gratuitement',
               legal='Nos conditions d’utilisation s’appliquent. Consultez notre politique de confidentialité pour en savoir plus.',
               col1='Sécurité|Aide|Contact', col2='Mentions légales|Confidentialité|CGU',
               newsletter='Oui, je souhaite recevoir les nouveautés et offres par e-mail. Désinscription possible à tout moment.'),
    'es': dict(emoji='Emojis y símbolos', undo='Deshacer', redo='Rehacer', cut='Cortar',
               copy='Copiar', paste='Pegar', pastematch='Pegar con el mismo estilo',
               selectall='Seleccionar todo', writedir='Dirección del texto', inspect='Inspeccionar',
               autofill='Autocompletar',
               heading='Tus datos de acceso', email='Correo electrónico', password='Contraseña', signup='Regístrate gratis',
               legal='Se aplican nuestras condiciones de uso. Consulta nuestra política de privacidad para más información.',
               col1='Seguridad|Ayuda|Contacto', col2='Aviso legal|Privacidad|Condiciones',
               newsletter='Sí, quiero recibir novedades y ofertas por correo electrónico. Puedo darme de baja en cualquier momento.'),
    'pt': dict(emoji='Emojis e símbolos', undo='Anular', redo='Refazer', cut='Cortar',
               copy='Copiar', paste='Colar', pastematch='Colar com o mesmo estilo',
               selectall='Selecionar tudo', writedir='Direção da escrita', inspect='Inspecionar',
               autofill='Preenchimento automático',
               heading='Os seus dados de acesso', email='E-mail', password='Palavra-passe', signup='Registar gratuitamente',
               legal='Aplicam-se os nossos termos de utilização. Consulte a nossa política de privacidade para mais informações.',
               col1='Segurança|Ajuda|Contacto', col2='Aviso legal|Privacidade|Termos',
               newsletter='Sim, quero receber novidades e ofertas por e-mail. Posso cancelar a subscrição a qualquer momento.'),
    'br': dict(emoji='Emojis e símbolos', undo='Desfazer', redo='Refazer', cut='Recortar',
               copy='Copiar', paste='Colar', pastematch='Colar com o mesmo estilo',
               selectall='Selecionar tudo', writedir='Direção da escrita', inspect='Inspecionar',
               autofill='Preenchimento automático',
               heading='Seus dados de acesso', email='E-mail', password='Senha', signup='Cadastre-se grátis',
               legal='Aplicam-se nossos termos de uso. Consulte nossa política de privacidade para mais informações.',
               col1='Segurança|Ajuda|Contato', col2='Aviso legal|Privacidade|Termos',
               newsletter='Sim, quero receber novidades e ofertas por e-mail. Posso cancelar a inscrição a qualquer momento.'),
}

def msg(d, key, subs=None):
    m = d[key]['message']
    m = m.replace('$PLUS$', '*')
    if subs:
        for k, v in subs.items():
            m = m.replace(f'${k}$', v)
    return m

BASE_CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1280px; height: 800px; overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; }
"""

# ============================================================
# Template 1: Create-Address-Dialog ("paste")
# ============================================================
def tpl_dialog(d, lang):
    e = html.escape
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{BASE_CSS}
body {{ background: #fff; display: flex; align-items: center; justify-content: center; }}
.window {{ width: 660px; border-radius: 12px; overflow: hidden;
  box-shadow: 0 22px 70px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.08); background: #fff; }}
.titlebar {{ position: relative; height: 38px; background: #fff; display: flex; align-items: center;
  justify-content: center; border-bottom: 1px solid #ececec; }}
.lights {{ position: absolute; left: 14px; display: flex; gap: 8px; }}
.lights span {{ width: 12px; height: 12px; border-radius: 50%; background: #c9c9c9; }}
.titlebar .wtitle {{ font-size: 13px; font-weight: 600; color: #9a9a9a; }}
.appheader {{ background: #fff; padding: 14px 20px; display: flex; align-items: center;
  justify-content: center; border-bottom: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(15,23,42,0.06); }}
.appheader img {{ height: 26px; }}
.appheader h1 {{ color: #1e293b; font-size: 16px; font-weight: 700; margin-left: 12px; }}
.dialog-body {{ background: linear-gradient(135deg, #f0fdff 0%, #e0f2fe 100%); padding: 18px; }}
.card {{ background: #fff; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04); }}
.card-body {{ padding: 20px 24px; }}
.form-group {{ margin-bottom: 14px; }}
.form-label {{ display: block; font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 7px; }}
.address-row {{ display: flex; align-items: center; gap: 8px; }}
.address-row .field {{ flex: 1; }}
.at-symbol {{ color: #94a3b8; font-weight: 600; font-size: 16px; }}
.field {{ width: 100%; padding: 10px 14px; font-size: 14px; border: 2px solid #e2e8f0; border-radius: 10px;
  background: #f8fafc; color: #1e293b; }}
.select {{ background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 14px center; padding-right: 40px; }}
.form-row {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }}
.checkbox-group {{ display: flex; flex-direction: column; gap: 10px; padding: 13px 16px; background: #f8fafc;
  border-radius: 12px; border: 1px solid #e2e8f0; }}
.checkbox-item {{ display: flex; align-items: center; gap: 12px; }}
.cbox {{ width: 19px; height: 19px; border-radius: 4px; background: #0e7490; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; }}
.cbox svg {{ width: 13px; height: 13px; }}
.checkbox-item label {{ font-size: 13px; color: #475569; line-height: 1.4; }}
.plus-info {{ font-size: 11px; color: #94a3b8; text-align: right; margin-top: 7px; }}
.btn-group {{ display: flex; gap: 12px; margin-top: 18px; }}
.btn {{ flex: 1; min-width: 120px; padding: 13px 16px; font-size: 14px; font-weight: 600; border: none;
  border-radius: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; text-align: center; }}
.btn-primary {{ background: linear-gradient(135deg, #0891b2 0%, #0e7490 100%); color: #fff;
  box-shadow: 0 4px 12px rgba(14,116,144,0.3); }}
.btn-secondary {{ background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }}
.btn-icon {{ font-size: 15px; }}
</style></head><body>
<div class="window">
  <div class="titlebar">
    <div class="lights"><span></span><span></span><span></span></div>
    <div class="wtitle">{e(msg(d,'createTitle'))}</div>
  </div>
  <div class="appheader"><img src="{LOGO}" alt=""><h1>{e(msg(d,'createTitle'))}</h1></div>
  <div class="dialog-body"><div class="card"><div class="card-body">
    <div class="form-group">
      <label class="form-label">{e(msg(d,'createNewAddress'))}</label>
      <div class="address-row">
        <div class="field">6989_sandra_geiger</div>
        <span class="at-symbol">@</span>
        <div class="field select">0box.eu</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">{e(msg(d,'optionsRealAddress'))}</label>
      <div class="field select">stephan@mail.de</div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">{e(msg(d,'optionsForwards'))}</label>
        <div class="field select">{e(msg(d,'unlimited'))}</div>
      </div>
      <div class="form-group">
        <label class="form-label">{e(msg(d,'optionsLifespan'))}</label>
        <div class="field select">{e(msg(d,'never'))}</div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:0">
      <div class="checkbox-group">
        <div class="checkbox-item"><span class="cbox"><svg viewBox="0 0 16 16"><path fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M2.5 8.5l3.5 3.5 7-8"/></svg></span><label>{e(msg(d,'optionsMasquerade'))}</label></div>
        <div class="checkbox-item"><span class="cbox"><svg viewBox="0 0 16 16"><path fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M2.5 8.5l3.5 3.5 7-8"/></svg></span><label>{e(msg(d,'optionsNotifyExpired'))}</label></div>
        <div class="checkbox-item"><span class="cbox"><svg viewBox="0 0 16 16"><path fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M2.5 8.5l3.5 3.5 7-8"/></svg></span><label>{e(msg(d,'optionsSendURL'))}</label></div>
      </div>
      <div class="plus-info">{e(msg(d,'optionsPlusInfo'))}</div>
    </div>
    <div class="btn-group">
      <button class="btn btn-primary"><span class="btn-icon">&#10003;</span><span>{e(msg(d,'buttonCreateAddress'))}</span></button>
      <button class="btn btn-secondary">{e(msg(d,'buttonCancel'))}</button>
      <button class="btn btn-secondary"><span class="btn-icon">&#128231;</span><span>{e(msg(d,'buttonAddressManagerShort'))}</span></button>
    </div>
  </div></div></div>
</div>
</body></html>"""

# ============================================================
# Template 2: Toolbar-Popup ("toolbar")
# ============================================================
def tpl_toolbar(d, lang):
    e = html.escape
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{BASE_CSS}
body {{ background: #eef1f8; }}
.tabstrip {{ height: 52px; background: #d3ddf5; display: flex; align-items: flex-end; padding: 0 90px; }}
.tab {{ width: 260px; height: 40px; background: #f6f8fc; border-radius: 12px 12px 0 0; display: flex;
  align-items: center; padding: 0 14px; gap: 8px; }}
.tab .fav {{ width: 16px; height: 16px; border-radius: 50%; background: linear-gradient(135deg,#38bdf8,#2563eb); }}
.tab .ttitle {{ font-size: 12.5px; color: #3c4043; }}
.toolbar {{ height: 56px; background: #f6f8fc; display: flex; align-items: center; padding: 0 16px; gap: 10px;
  border-bottom: 1px solid #dadce0; }}
.navbtn {{ width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; color: #5f6368; font-size: 17px; }}
.omnibox {{ flex: 1; height: 36px; background: #e9edf6; border-radius: 18px; display: flex; align-items: center;
  padding: 0 14px; color: #5f6368; font-size: 13.5px; gap: 8px; }}
.omnibox .lock {{ font-size: 12px; }}
.omnibox .star {{ margin-left: auto; font-size: 16px; }}
.ext-pill {{ display: flex; align-items: center; background: #fff; border: 1px solid #dadce0; border-radius: 18px;
  padding: 3px; gap: 2px; }}
.ext-icon {{ width: 30px; height: 30px; border-radius: 50%; background: #e4e7ee; display: flex; align-items: center;
  justify-content: center; }}
.ext-icon img {{ height: 18px; }}
.puzzle {{ width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; color: #5f6368; }}
.avatar {{ width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg,#0891b2,#0e7490);
  color: #fff; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; }}
.page {{ height: 100%; background: #fff; }}
.popup {{ position: absolute; top: 116px; right: 118px; width: 330px; background: #fff; border-radius: 12px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06); overflow: hidden; }}
.popup .header {{ padding: 16px; text-align: center; border-bottom: 1px solid #e2e8f0; }}
.popup .header img {{ height: 36px; }}
.popup .content {{ padding: 16px; }}
.security {{ padding: 16px 14px; border-radius: 10px; text-align: center; background: #f8fafc;
  border: 1px solid #e2e8f0; color: #64748b; }}
.security .icon {{ font-size: 30px; display: block; margin-bottom: 8px; }}
.security .stext {{ font-weight: 600; font-size: 14.5px; color: #475569; }}
.security .sdetail {{ font-size: 12px; margin-top: 5px; }}
.divider {{ height: 1px; background: linear-gradient(90deg, transparent, #e2e8f0, transparent); margin: 14px 0; }}
.btn {{ display: flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 16px; border: none;
  border-radius: 8px; font-size: 14.5px; font-weight: 500; width: 100%; }}
.btn-primary {{ background: linear-gradient(135deg, #0891b2 0%, #0e7490 100%); color: #fff;
  box-shadow: 0 2px 8px rgba(14,116,144,0.3); margin-bottom: 10px; }}
.btn-secondary {{ background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }}
</style></head><body>
<div class="tabstrip"><div class="tab"><span class="fav"></span><span class="ttitle">Aionda Mail</span></div></div>
<div class="toolbar">
  <span class="navbtn">&#8592;</span><span class="navbtn" style="color:#b8bcc2">&#8594;</span><span class="navbtn">&#10227;</span>
  <div class="omnibox"><span class="lock">&#128274;</span> mail.aionda.com <span class="star">&#9734;</span></div>
  <div class="ext-pill">
    <div class="ext-icon"><img src="{LOGO.replace('menu@1x.png','Icon-32.png')}" alt=""></div>
    <div class="puzzle"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#5f6368" stroke-width="2"><path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg></div>
  </div>
  <div class="avatar">S</div>
</div>
<div class="page"></div>
<div class="popup">
  <div class="header"><img src="{LOGO}" alt="Aionda Mail"></div>
  <div class="content">
    <div class="security">
      <span class="icon">&#128274;</span>
      <span class="stext">{e(msg(d,'guardianDisabled'))}</span>
      <div class="sdetail">{e(msg(d,'guardianEnableInOptions'))}</div>
    </div>
    <div class="divider"></div>
    <button class="btn btn-primary"><span>&#128231;</span><span>{e(msg(d,'buttonAddressManagerShort'))}</span></button>
    <button class="btn btn-secondary"><span>&#9881;&#65039;</span><span>{e(msg(d,'buttonSettings'))}</span></button>
  </div>
</div>
</body></html>"""

# ============================================================
# Template 3: Kontextmenü auf Anmeldeformular ("menu")
# ============================================================
def tpl_menu(d, lang):
    e = html.escape
    o = OS[lang]
    ext_name = msg(d, 'extensionName')
    paste_prev = msg(d, 'menuPastePrevious', {'EMAIL': 'saw_odf7gj@0box.eu'})
    footer_col1 = ''.join(f'<div>{e(x)}</div>' for x in o['col1'].split('|'))
    footer_col2 = ''.join(f'<div>{e(x)}</div>' for x in o['col2'].split('|'))
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
{BASE_CSS}
body {{ background: #f4f4f2; }}
.formpanel {{ position: absolute; top: 40px; left: 60px; width: 520px; background: #fff; border-radius: 8px;
  padding: 28px 32px; }}
.formpanel h2 {{ font-size: 22px; font-weight: 700; color: #1a1a1a; margin-bottom: 20px; }}
.finput {{ position: relative; border: 2px solid #1a1a1a; border-radius: 6px; padding: 8px 14px 10px; margin-bottom: 16px; }}
.finput .flabel {{ font-size: 12px; color: #757575; }}
.finput .caret {{ display: inline-block; width: 1.5px; height: 17px; background: #1a1a1a; margin-top: 2px; }}
.finput.dim {{ border: 1px solid #cfcfcf; padding: 9px 14px 11px; }}
.finput.dim .flabel {{ font-size: 15px; padding: 6px 0 7px; }}
.fcheck {{ display: flex; gap: 10px; margin-bottom: 18px; }}
.fcheck .box {{ width: 20px; height: 20px; border: 1px solid #bbb; border-radius: 4px; flex-shrink: 0; }}
.fcheck .txt {{ font-size: 13px; color: #9c9c9c; line-height: 1.45; filter: blur(2.5px); }}
.fbtn {{ background: linear-gradient(180deg,#b4e94c,#95d420); border-radius: 24px; height: 46px;
  width: 60%; display: flex; align-items: center; justify-content: center; color: #2e4d00; font-weight: 700;
  font-size: 15px; filter: blur(2px); margin-bottom: 18px; }}
.flegal {{ font-size: 12px; color: #8a8a8a; line-height: 1.5; }}
.footer {{ position: absolute; bottom: 0; left: 0; right: 0; height: 210px; background: #ececea;
  border-top: 1px solid #dedede; padding: 26px 60px; color: #6f6f6f; font-size: 13.5px; }}
.footer .cols {{ display: flex; gap: 90px; }}
.footer .col div {{ margin-bottom: 9px; }}
/* --- macOS Kontextmenü --- */
.menu {{ position: absolute; top: 118px; left: 300px; width: 340px; background: rgba(252,252,252,0.97);
  border-radius: 10px; padding: 5px; box-shadow: 0 12px 45px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(0,0,0,0.12);
  font-size: 14.5px; color: #1d1d1f; }}
.mi {{ padding: 5px 12px; border-radius: 6px; display: flex; align-items: center; gap: 9px; }}
.mi.dis {{ color: #b5b5b7; }}
.mi .arrow {{ margin-left: auto; color: #86868b; font-size: 12px; }}
.mi.dis .arrow {{ color: #cccccf; }}
.msep {{ height: 1px; background: #e4e4e6; margin: 5px 12px; }}
.mi.ext {{ background: #ececee; }}
.mi.ext img {{ height: 16px; }}
.mi.ext .arrow {{ color: #55555a; }}
/* Submenü */
.submenu {{ position: absolute; top: 468px; left: 636px; width: 560px; background: rgba(252,252,252,0.97);
  border-radius: 10px; padding: 5px; box-shadow: 0 12px 45px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(0,0,0,0.12);
  font-size: 14.5px; color: #1d1d1f; }}
.submenu .mi.hl {{ background: #3478f6; color: #fff; }}
</style></head><body>
<div class="formpanel">
  <h2>{e(o['heading'])}</h2>
  <div class="finput"><div class="flabel">{e(o['email'])}</div><span class="caret"></span></div>
  <div class="finput dim"><div class="flabel">{e(o['password'])}</div></div>
  <div class="fcheck"><span class="box"></span><span class="txt">{e(o['newsletter'])}</span></div>
  <div class="fbtn">{e(o['signup'])}</div>
  <div class="flegal">{e(o['legal'])}</div>
</div>
<div class="footer">
  <div class="cols">
    <div class="col"><div class="head">&nbsp;</div>{footer_col1}</div>
    <div class="col"><div class="head">&nbsp;</div>{footer_col2}</div>
  </div>
</div>
<div class="menu">
  <div class="mi">{o['emoji']}</div>
  <div class="msep"></div>
  <div class="mi">{e(o['undo'])}</div>
  <div class="mi dis">{e(o['redo'])}</div>
  <div class="msep"></div>
  <div class="mi dis">{e(o['cut'])}</div>
  <div class="mi dis">{e(o['copy'])}</div>
  <div class="mi">{e(o['paste'])}</div>
  <div class="mi">{e(o['pastematch'])}</div>
  <div class="mi dis">{e(o['selectall'])}</div>
  <div class="msep"></div>
  <div class="mi">{e(o['writedir'])}<span class="arrow">&#9654;</span></div>
  <div class="msep"></div>
  <div class="mi ext"><img src="{LOGO.replace('menu@1x.png','Icon-16.png')}" alt="">{e(ext_name)}<span class="arrow">&#9654;</span></div>
  <div class="msep"></div>
  <div class="mi">{e(o['inspect'])}</div>
  <div class="mi">{e(o['autofill'])}<span class="arrow">&#9654;</span></div>
</div>
<div class="submenu">
  <div class="mi hl">{e(msg(d,'menuPasteAddress'))}</div>
  <div class="mi">{e(paste_prev)} (/s-haus-kaufen/interessantes-haus/k0c208)</div>
</div>
</body></html>"""

# ============================================================
manifest = []
for lang in LANGS:
    d = json.load(open(f'{ADDON}/_locales/{lang}/messages.json'))
    for name, fn in [('paste', tpl_dialog), ('toolbar', tpl_toolbar), ('menu', tpl_menu)]:
        path = os.path.join(OUT, f'{lang}_{name}.html')
        with open(path, 'w') as f:
            f.write(fn(d, lang))
        manifest.append({'lang': lang, 'name': name, 'html': path})

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=2)
print(f"{len(manifest)} HTML-Dateien generiert in {OUT}")
