const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// ------------------- PATHS --------------------
const dadosBasePath = path.join(__dirname, 'data', 'dados_base.json');
const usuariosPath = path.join(__dirname, 'data', 'usuarios.json');
const CHAMADOS_FILE = path.join(__dirname, 'chamados.json');
const BACKUP_DIR = path.join(__dirname, 'backups');

// ------------------- SERVER -------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------- CARREGAR DADOS -------------------
const dadosBase = JSON.parse(fs.readFileSync(dadosBasePath));

// ------------------- FUNÇÕES -------------------
function lerUsuarios() {
  return JSON.parse(fs.readFileSync(usuariosPath));
}

function lerChamados() {
  if (!fs.existsSync(CHAMADOS_FILE)) return [];
  return JSON.parse(fs.readFileSync(CHAMADOS_FILE));
}

function salvarChamados(chamados) {
  fs.writeFileSync(CHAMADOS_FILE, JSON.stringify(chamados, null, 2));
}

// Criar pasta backups se não existir
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// ------------------- ROTAS -------------------

// Dados base
app.get('/dados_base', (req, res) => {
  const usuarios = lerUsuarios();
  res.json({
    setores_responsaveis: dadosBase.setores_responsaveis,
    equipamentos: dadosBase.equipamentos,
    responsaveis: dadosBase.responsaveis,
    usuarios
  });
});

// Criar usuário
app.post('/usuarios', (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) {
    return res.status(400).json({ erro: 'Nome inválido.' });
  }

  const usuarios = lerUsuarios();
  if (usuarios.includes(nome)) {
    return res.status(400).json({ erro: 'Usuário já existe.' });
  }

  usuarios.push(nome);
  fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2));

  res.status(201).json({ sucesso: true, nome });
});

// Listar usuários
app.get('/usuarios', (req, res) => {
  res.json(lerUsuarios());
});

// Listar todos os chamados
app.get('/chamados', (req, res) => {
  res.json(lerChamados());
});

// Fila de chamados (sem filtro)
app.get('/fila-chamados', (req, res) => {
  res.json(lerChamados());
});

// Criar novo chamado
app.post('/chamados', (req, res) => {
  const { setor, usuario, equipamento, problema, responsavel } = req.body;

  const usuarios = lerUsuarios();

  if (!Object.keys(dadosBase.setores_responsaveis).includes(setor)) {
    return res.status(400).json({ erro: 'Setor inválido.' });
  }
  if (!usuarios.includes(usuario)) {
    return res.status(400).json({ erro: 'Usuário inválido.' });
  }
  if (!dadosBase.equipamentos.includes(equipamento)) {
    return res.status(400).json({ erro: 'Equipamento inválido.' });
  }

  const chamados = lerChamados();

  const novoChamado = {
    id: Date.now(),
    setor,
    usuario,
    responsavel: responsavel || '',
    equipamento,
    problema,
    status: 'Aberto',
    comentarioSolucao: '',
    dataAbertura: new Date().toISOString(),
    dataFinalizacao: null
  };

  chamados.push(novoChamado);
  salvarChamados(chamados);

  res.status(201).json(novoChamado);
});

// Atualizar chamado
app.put('/chamados/:id', (req, res) => {
  const chamados = lerChamados();
  const id = parseInt(req.params.id);
  const index = chamados.findIndex(ch => ch.id === id);

  if (index === -1) {
    return res.status(404).json({ erro: 'Chamado não encontrado' });
  }

  const camposPermitidos = [
    'setor', 'usuario', 'equipamento', 'problema',
    'responsavel', 'status', 'comentarioSolucao'
  ];

  camposPermitidos.forEach(campo => {
    if (req.body[campo] !== undefined) {
      chamados[index][campo] = req.body[campo];
    }
  });

  if (req.body.status === 'Resolvido') {
    chamados[index].dataFinalizacao = new Date().toISOString();
  } else if (req.body.status && req.body.status !== 'Resolvido') {
    chamados[index].dataFinalizacao = null;
  }

  salvarChamados(chamados);
  res.json(chamados[index]);
});

// Aviso 1 dia antes do backup
app.get('/avisos-backup', (req, res) => {
  try {
    if (!fs.existsSync(CHAMADOS_FILE)) {
      return res.json({ aviso: false, total: 0 });
    }

    const chamados = lerChamados();
    const agora = new Date();
    const duasSemanas = 14 * 24 * 60 * 60 * 1000;
    const umDia = 24 * 60 * 60 * 1000;

    const avisos = chamados.filter(c => {
      const idade = agora - new Date(c.dataAbertura);
      return idade >= (duasSemanas - umDia) && idade < duasSemanas;
    });

    res.json({ aviso: avisos.length > 0, total: avisos.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: 'Erro ao verificar avisos de backup' });
  }
});

// ------------------- BACKUP AUTOMÁTICO -------------------
function fazerBackupAutomático() {
  try {
    if (!fs.existsSync(CHAMADOS_FILE)) return;

    const chamados = lerChamados();
    const agora = new Date();
    const duasSemanas = 14 * 24 * 60 * 60 * 1000;

    const antigos = chamados.filter(c => new Date(c.dataAbertura) < (agora - duasSemanas));
    const recentes = chamados.filter(c => new Date(c.dataAbertura) >= (agora - duasSemanas));

    if (antigos.length === 0) {
      console.log('🕓 Nenhum chamado antigo para arquivar agora.');
      return;
    }

    const dataArquivo = new Date().toISOString().split('T')[0];
    const backupFile = path.join(BACKUP_DIR, `backup_chamados_${dataArquivo}.xlsx`);

    const worksheet = XLSX.utils.json_to_sheet(antigos);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Chamados Antigos');
    XLSX.writeFile(workbook, backupFile);

    fs.writeFileSync(CHAMADOS_FILE, JSON.stringify(recentes, null, 2));

    console.log(`✅ Backup salvo (${antigos.length} chamados) → ${backupFile}`);

  } catch (err) {
    console.error('❌ Erro ao fazer backup automático:', err);
  }
}

// Rodar a cada 14 dias às 3h
cron.schedule('0 3 */14 * *', fazerBackupAutomático);

// Roda 1x ao inicializar
fazerBackupAutomático();

// ------------------- INICIAR SERVIDOR -------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});





