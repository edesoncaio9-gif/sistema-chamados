const xlsx = require("xlsx");
const fs = require("fs");


const workbook = xlsx.readFile("chamados2.xlsm");


const aba = workbook.SheetNames[1]; 
const planilha = xlsx.utils.sheet_to_json(workbook.Sheets[aba], { defval: "" });

const setores_responsaveis = {};
const usuariosSetores = [];
const equipamentosSet = new Set();


planilha.forEach((linha) => {
  const setor = linha["SETOR"];
  const responsavel = linha["RESPONSÁVEL"];
  const usuario = linha["USUÁRIO"];
  const equipamento = linha["EQUIPAMENTO"];

  if (setor && responsavel && !setores_responsaveis[setor]) {
    setores_responsaveis[setor] = responsavel;
  }

  if (usuario && setor) {
    usuariosSetores.push({ usuario, setor });
  }

  if (equipamento) {
    equipamentosSet.add(equipamento);
  }
});


const equipamentos = [...equipamentosSet];

const dadosFinal = {
  setores_responsaveis,
  usuariosSetores,
  equipamentos
};


fs.writeFileSync("dados_base.json", JSON.stringify(dadosFinal, null, 2), "utf-8");

console.log("✔️ Arquivo 'dados_base.json' criado com sucesso!");
