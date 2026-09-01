/* ================================================================
   GODI — Dashboard Comercial
   Camada de dados compartilhada entre todas as páginas.
   Cada página HTML inclui este arquivo antes do seu script próprio.
   ================================================================ */

const SHEET_ID = '1qRBF5ffDuDFwDSZcxdst2Sb7Cy-xuBUKcnppjIUpqh8';
function csvUrl(){
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&t=${Date.now()}`;
}

const MESES_PT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const STATUS_COLORS = {
  'GANHO': 'var(--green-600)',
  'PREÇO': 'var(--teal-500)',
  'ABERTO': 'var(--slate-400)',
  'SEM RESPOSTA': 'var(--amber-500)',
  'CANCELADO': 'var(--red-500)'
};
const LOST_STATUSES = ['PREÇO', 'SEM RESPOSTA', 'CANCELADO'];

const $ = id => document.getElementById(id);

/* ---------- CSV parsing (handles quoted fields with commas) ---------- */
function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if(c === '"') inQuotes = true;
      else if(c === ','){ row.push(field); field=''; }
      else if(c === '\n'){ row.push(field); rows.push(row); row=[]; field=''; }
      else if(c === '\r'){ /* skip */ }
      else field += c;
    }
  }
  if(field.length || row.length){ row.push(field); rows.push(row); }
  return rows;
}

function normStr(s){ return (s||'').replace(/\s+/g,' ').trim(); }

function parseBRLNumber(s){
  if(!s) return 0;
  const clean = normStr(s).replace(/R\$/g,'').replace(/\./g,'').replace(/,/g,'.').replace(/[^\d.\-]/g,'');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}
function parseBRLPercent(s){
  if(!s) return null;
  const clean = normStr(s).replace('%','').replace(/\./g,'').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}
function parseBRLDate(s){
  if(!s) return null;
  const m = normStr(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return null;
  return new Date(+m[3], +m[2]-1, +m[1]);
}

function fmtBRL(n){
  return n.toLocaleString('pt-BR', {style:'currency', currency:'BRL', maximumFractionDigits:0});
}
function fmtPct(n){
  return n.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}) + '%';
}
function fmtBRLShort(n){
  if(Math.abs(n) >= 1000) return 'R$ ' + (n/1000).toLocaleString('pt-BR',{maximumFractionDigits:1}) + 'k';
  return fmtBRL(n);
}

/* ---------- Fetch + parse the sheet into records ---------- */
async function fetchRecords(){
  const res = await fetch(csvUrl(), {cache:'no-store'});
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const rows = parseCSV(text);
  if(!rows.length) throw new Error('Planilha retornou vazia');

  const header = rows[0].map(h => normStr(h));
  const idx = name => header.indexOf(name);
  const iCliente = idx('CLIENTE');
  const iData = idx('DATA');
  const iFrete = idx('R$ EMPRESA');
  const iComPct = idx('COMISSÃO');
  const iRent = idx('RENTABILIDADE');
  const iVCom = idx('V. COM');
  const iStatus = idx('STATUS');
  const iVeiculo = idx('VEÍCULO');
  const iOrigem = idx('ORIGEM');
  const iDestino = idx('DESTINO');
  const iProtocolo = idx('PROTOCOLO');

  if(iCliente < 0 || iStatus < 0) throw new Error('Não encontrei as colunas CLIENTE/STATUS na planilha');

  const out = [];
  for(let r=1; r<rows.length; r++){
    const row = rows[r];
    const status = normStr(row[iStatus]);
    const cliente = normStr(row[iCliente]);
    if(!status || !cliente) continue; // linhas em branco / side-tables / status ainda não preenchido
    out.push({
      protocolo: normStr(row[iProtocolo]),
      data: parseBRLDate(row[iData]),
      cliente: cliente,
      origem: normStr(row[iOrigem]),
      destino: normStr(row[iDestino]),
      veiculo: normStr(row[iVeiculo]),
      freteEmpresa: parseBRLNumber(row[iFrete]),
      comissaoPct: parseBRLPercent(row[iComPct]),
      rentabilidade: parseBRLPercent(row[iRent]),
      vCom: parseBRLNumber(row[iVCom]),
      status: status
    });
  }
  return out;
}

/* ================================================================
   GODI namespace — estado de filtro compartilhado entre páginas
   (persistido via sessionStorage, então sobrevive à navegação)
   ================================================================ */
const GODI = {
  RECORDS: [],
  state: { cliente: '', tipo: 'todos', ano: '', mes: '', semana: '' },

  loadState(){
    try{
      const raw = sessionStorage.getItem('godi-filters');
      if(raw) this.state = Object.assign(this.state, JSON.parse(raw));
    }catch(e){ /* ignore */ }
  },
  saveState(){
    try{ sessionStorage.setItem('godi-filters', JSON.stringify(this.state)); }
    catch(e){ /* ignore */ }
  },

  /* Carrega os dados da planilha e cuida dos elementos padrão de
     loading / erro / status que toda página deve ter:
     #loading, #error-box, #error-msg, #status-dot, #status-text, #content, #footer-time */
  async boot(onReady){
    this.loadState();
    if($('loading')) $('loading').style.display = 'block';
    if($('error-box')) $('error-box').style.display = 'none';
    if($('content')) $('content').style.display = 'none';
    if($('status-dot')) $('status-dot').className = 'status-dot';
    if($('status-text')) $('status-text').textContent = 'Conectando à planilha...';

    try{
      this.RECORDS = await fetchRecords();
      if($('status-dot')) $('status-dot').className = 'status-dot ok';
      if($('status-text')) $('status-text').textContent = `${this.RECORDS.length} cotações carregadas`;
      if($('footer-time')) $('footer-time').textContent = new Date().toLocaleString('pt-BR');
      if($('loading')) $('loading').style.display = 'none';
      if($('content')) $('content').style.display = 'block';
      onReady(this.RECORDS);
    } catch(err){
      console.error(err);
      if($('status-dot')) $('status-dot').className = 'status-dot err';
      if($('status-text')) $('status-text').textContent = 'Falha ao carregar';
      if($('loading')) $('loading').style.display = 'none';
      if($('error-box')) $('error-box').style.display = 'block';
      if($('error-msg')) $('error-msg').textContent = 'Detalhe técnico: ' + err.message + '. Confira se a planilha continua compartilhada como "qualquer pessoa com o link".';
    }
  },

  /* Liga o botão de atualizar (se existir na página) */
  wireRefresh(onReady){
    const btn = $('refresh-btn');
    if(!btn) return;
    btn.addEventListener('click', () => {
      btn.classList.add('spinning');
      this.boot(onReady).finally(() => btn.classList.remove('spinning'));
    });
  },

  /* Monta as opções dos selects de filtro a partir dos RECORDS e
     restaura o estado salvo (se os valores ainda existirem) */
  buildFilters(){
    const clientes = [...new Set(this.RECORDS.map(r => r.cliente))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    if($('f-cliente')){
      $('f-cliente').innerHTML = '<option value="">Todos os clientes</option>' +
        clientes.map(c => `<option value="${c}">${c}</option>`).join('');
      $('f-cliente').value = clientes.includes(this.state.cliente) ? this.state.cliente : '';
      this.state.cliente = $('f-cliente').value;
    }

    if($('f-ano')){
      const anos = [...new Set(this.RECORDS.filter(r=>r.data).map(r => r.data.getFullYear()))].sort();
      $('f-ano').innerHTML = anos.map(a => `<option value="${a}">${a}</option>`).join('');
      if(anos.map(String).includes(this.state.ano)) $('f-ano').value = this.state.ano;
    }

    if($('f-mes')){
      const meses = [...new Set(this.RECORDS.filter(r=>r.data).map(r => `${r.data.getFullYear()}-${String(r.data.getMonth()+1).padStart(2,'0')}`))].sort();
      $('f-mes').innerHTML = meses.map(m => {
        const [y,mm] = m.split('-');
        return `<option value="${m}">${MESES_PT[+mm-1]}/${y}</option>`;
      }).join('');
      if(meses.includes(this.state.mes)) $('f-mes').value = this.state.mes;
    }

    if($('f-tipo')){
      $('f-tipo').value = this.state.tipo || 'todos';
      this._toggleGroups();
    }
    this._refreshWeekOptions();
  },

  _toggleGroups(){
    const v = $('f-tipo') ? $('f-tipo').value : 'todos';
    if($('grp-ano')) $('grp-ano').style.display = v === 'ano' ? 'flex' : 'none';
    if($('grp-mes')) $('grp-mes').style.display = (v === 'mes' || v === 'semana') ? 'flex' : 'none';
    if($('grp-semana')) $('grp-semana').style.display = v === 'semana' ? 'flex' : 'none';
  },

  _refreshWeekOptions(){
    if(!$('f-semana')) return;
    const mesVal = $('f-mes') ? ($('f-mes').value || $('f-mes').options[0]?.value) : null;
    if(!mesVal){ $('f-semana').innerHTML=''; return; }
    const [y,mm] = mesVal.split('-').map(Number);
    const lastDay = new Date(y, mm, 0).getDate();
    const totalWeeks = Math.ceil(lastDay/7);
    let opts = '';
    for(let w=1; w<=totalWeeks; w++){
      const startDay = (w-1)*7+1;
      const endDay = Math.min(w*7, lastDay);
      opts += `<option value="${w}">${w}ª semana (${startDay}–${endDay})</option>`;
    }
    $('f-semana').innerHTML = opts;
    if(this.state.semana) $('f-semana').value = this.state.semana;
  },

  periodMatches(rec){
    const tipo = this.state.tipo;
    if(tipo === 'todos') return true;
    if(!rec.data) return false;
    if(tipo === 'ano'){
      return rec.data.getFullYear() === +this.state.ano;
    }
    if(tipo === 'mes'){
      const [y,m] = (this.state.mes||'').split('-').map(Number);
      return rec.data.getFullYear() === y && (rec.data.getMonth()+1) === m;
    }
    if(tipo === 'semana'){
      const [y,m] = (this.state.mes||'').split('-').map(Number);
      if(rec.data.getFullYear() !== y || (rec.data.getMonth()+1) !== m) return false;
      const week = Math.ceil(rec.data.getDate()/7);
      return week === +this.state.semana;
    }
    return true;
  },

  getFiltered(){
    return this.RECORDS.filter(r => (!this.state.cliente || r.cliente === this.state.cliente) && this.periodMatches(r));
  },
  getClientFiltered(){
    return this.RECORDS.filter(r => !this.state.cliente || r.cliente === this.state.cliente);
  },

  /* Liga todos os controles de filtro presentes na página a um
     callback de render, e já dispara o render inicial. */
  wireFilterBar(onChange){
    const rerender = () => { this.saveState(); this._updateBanner(); onChange(); };

    if($('f-tipo')) $('f-tipo').addEventListener('change', () => {
      this.state.tipo = $('f-tipo').value;
      this._toggleGroups();
      if(this.state.tipo === 'semana') this._refreshWeekOptions();
      rerender();
    });
    if($('f-ano')) $('f-ano').addEventListener('change', () => { this.state.ano = $('f-ano').value; rerender(); });
    if($('f-mes')) $('f-mes').addEventListener('change', () => { this.state.mes = $('f-mes').value; this._refreshWeekOptions(); rerender(); });
    if($('f-semana')) $('f-semana').addEventListener('change', () => { this.state.semana = $('f-semana').value; rerender(); });
    if($('f-cliente')) $('f-cliente').addEventListener('change', () => { this.state.cliente = $('f-cliente').value; rerender(); });
    if($('client-banner-clear')) $('client-banner-clear').addEventListener('click', () => {
      this.state.cliente = '';
      if($('f-cliente')) $('f-cliente').value = '';
      rerender();
    });
    if($('btn-limpar')) $('btn-limpar').addEventListener('click', () => {
      this.state = Object.assign(this.state, {cliente:'', tipo:'todos', ano:'', mes:'', semana:''});
      if($('f-cliente')) $('f-cliente').value = '';
      if($('f-tipo')) $('f-tipo').value = 'todos';
      this._toggleGroups();
      rerender();
    });

    this._updateBanner();
    onChange();
  },

  _updateBanner(){
    if(!$('client-banner')) return;
    if(this.state.cliente){
      $('client-banner').classList.add('show');
      if($('client-banner-name')) $('client-banner-name').textContent = this.state.cliente;
    } else {
      $('client-banner').classList.remove('show');
    }
  },

  /* Usado pelos cliques em rankings: seleciona um cliente e recarrega a página atual */
  selectClientAndReload(cliente){
    this.state.cliente = cliente;
    this.saveState();
    location.reload();
  }
};
