export class RoundStartStatus {
  private readonly panel = document.createElement('div');
  private readonly heading = document.createElement('strong');
  private readonly detail = document.createElement('span');
  private readonly standard = document.createElement('button');
  private readonly leadIn = document.createElement('p');

  constructor(hud: HTMLElement, playStandard: () => void) {
    this.panel.className = 'round-start-status';
    this.panel.hidden = true;
    const text = document.createElement('div');
    text.setAttribute('role', 'status');
    text.setAttribute('aria-atomic', 'true');
    text.append(this.heading, this.detail);
    this.standard.type = 'button';
    this.standard.textContent = 'Play with standard backing';
    this.standard.onclick = playStandard;
    this.panel.append(text, this.standard);
    this.leadIn.className = 'round-start-lead-in';
    this.leadIn.setAttribute('role', 'status');
    this.leadIn.hidden = true;
    hud.append(this.leadIn);
  }

  show(anchor: HTMLElement, heading: string, detail: string, standard = false): void {
    if (!this.panel.isConnected || this.panel.previousElementSibling !== anchor) anchor.after(this.panel);
    this.panel.hidden = false;
    if (this.heading.textContent !== heading) this.heading.textContent = heading;
    if (this.detail.textContent !== detail) this.detail.textContent = detail;
    this.standard.hidden = !standard;
  }

  clear(): void {
    this.panel.hidden = true;
  }

  begin(countIn: boolean, harpUnavailable: boolean): void {
    this.clear();
    this.leadIn.textContent = [countIn ? 'Count-in' : 'Starting shortly', harpUnavailable ? 'Harp unavailable — using standard backing' : '']
      .filter(Boolean).join(' · ');
    this.leadIn.hidden = false;
  }

  endLeadIn(): void {
    this.leadIn.hidden = true;
  }
}
