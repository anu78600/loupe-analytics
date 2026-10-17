/**
 * Column-name normalisation shared by profiling, domain detection and the
 * parser: tokenize() turns a header into canonical English tokens, and
 * nameSimilarity() scores those tokens against a registry synonym, which is
 * tokenised the same way.
 *
 * Tokens are the vocabulary that role rules (roles.ts), quality checks, the
 * parser's date-name checks and domain synonyms (detect/match.ts) compare, so
 * a header reads the same whatever tool, country or language wrote it:
 * "quantity", not "qty"; "percent", not "pct"; "city", not "Município";
 * "money" for any currency mark or code ("₹", "US$", "EUR"); "crore", "lakh",
 * "million" for scale words; "kg", "litre", "sqft" for units. tokenize()
 * lists the steps and why they run in that order.
 */

// ---------------------------------------------------------------- abbreviations and compounds

/**
 * Lower-case abbreviation → canonical token(s), applied after translation and
 * before singularisation and the second compound fold. A value with a space
 * stands for several tokens ("empno" → employee number).
 */
const ABBREVIATIONS: Record<string, string> = {
  qty: "quantity",
  qnty: "quantity",
  quantities: "quantity",
  amt: "amount",
  amnt: "amount",
  cust: "customer",
  custid: "customer",
  cstmr: "customer",
  clnt: "client",
  emp: "employee",
  empl: "employee",
  empid: "employee",
  prod: "product",
  prd: "product",
  prdct: "product",
  num: "number",
  no: "number",
  nbr: "number",
  nr: "number",
  "#": "number",
  "%": "percent",
  dt: "date",
  desc: "description",
  cat: "category",
  categ: "category",
  subcat: "subcategory",
  addr: "address",
  ph: "phone",
  tel: "phone",
  mob: "mobile",
  pin: "pincode",
  txn: "transaction",
  txns: "transaction",
  trx: "transaction",
  trxn: "transaction",
  trans: "transaction",
  tran: "transaction",
  inv: "invoice",
  invc: "invoice",
  vch: "voucher",
  rev: "revenue",
  disc: "discount",
  pct: "percent",
  perc: "percent",
  percentage: "percent",
  avg: "average",
  val: "value",
  dept: "department",
  mgr: "manager",
  sal: "salary",
  acct: "account",
  acc: "account",
  accnt: "account",
  acnt: "account",
  bal: "balance",
  yr: "year",
  mth: "month",
  mnth: "month",
  wk: "week",
  qtr: "quarter",
  loc: "location",
  reg: "region",
  ctry: "country",
  cntry: "country",
  ord: "order",
  pmt: "payment",
  pymt: "payment",
  paymt: "payment",
  pay: "payment",
  ship: "shipping",
  shp: "shipping",
  shipment: "shipping",
  deliv: "delivery",
  dlv: "delivery",
  delivered: "delivery",
  refnd: "refund",
  recv: "received",
  rcvd: "received",
  recd: "received",
  impr: "impression",
  imps: "impression",
  clk: "click",
  conv: "conversion",
  convs: "conversion",
  sess: "session",
  cnt: "count",
  tot: "total",
  ttl: "total",
  nm: "name",
  cd: "code",
  flg: "flag",
  doc: "document",
  docs: "document",
  dob: "birthdate",
  doj: "joiningdate",
  uid: "id",
  guid: "id",
  uuid: "id",
  ref: "reference",
  src: "source",
  sp: "sellingprice",
  cp: "costprice",
  uom: "unit",
  spent: "spend",
  sls: "sale",
  chrg: "charge",
  vol: "volume",
  wt: "weight",
  wgt: "weight",
  wght: "weight",
  hgt: "height",
  zip5: "zipcode",
  zip4: "zipcode",
  // Indian salary notation: CTC "in LPA" is lakhs per annum.
  lpa: "lakh annual",
  // Legacy fused names (Oracle's EMPNO, DEPTNO): an entity and its number in one short word.
  empno: "employee number",
  deptno: "department number",
  custno: "customer number",
  acctno: "account number",
  invno: "invoice number",
  ordno: "order number",
};

/**
 * Two-token compounds folded into one canonical token. Folding runs twice:
 * on the raw words ("pin code", before "pin" expands to "pincode") and again
 * on the expanded, singular tokens ("sub cat" → "sub category"), so a key
 * may use either form. "No" in "no show" and "no claim" is the word, not
 * "number", so those fold before the abbreviation could expand it.
 */
const COMPOUNDS: Record<string, string> = {
  "sub category": "subcategory",
  "sub total": "subtotal",
  "e mail": "email",
  "zip code": "zipcode",
  "pin code": "pincode",
  "post code": "postcode",
  "postal code": "postcode",
  "first name": "firstname",
  "last name": "lastname",
  "user name": "username",
  "time stamp": "timestamp",
  "date time": "datetime",
  "mrp price": "mrp",
  "add to": "addto",
  "check out": "checkout",
  "cash on": "cashon",
  "selling price": "sellingprice",
  "cost price": "costprice",
  "list price": "listprice",
  "unit price": "unitprice",
  "no show": "noshow",
  "no claim": "noclaim",
};

/**
 * A table's own entry for a word. A plain lookup would reach Object.prototype
 * for header words such as "constructor" ("constructorId") or "toString", and
 * return a function instead of a token.
 */
const own = (table: Readonly<Record<string, string>>, word: string): string | undefined =>
  Object.hasOwn(table, word) ? table[word] : undefined;

/** Endings whose final "s" is kept: status, address, analysis, metrics, holidays. */
const KEEP_S = /(ss|us|is|ys|ics|ies)$/;

/** Words the plural rules would mangle: invariant "-ies" words and plurals of "-ie" words. */
const PLURAL_EXCEPTIONS: Record<string, string> = {
  series: "series",
  species: "species",
  movies: "movie",
  cookies: "cookie",
  calories: "calorie",
};

/**
 * Light plural folding for words longer than four letters: "-ies" → "-y",
 * otherwise drop a final "s" unless KEEP_S matches. PLURAL_EXCEPTIONS covers
 * the words those rules get wrong ("series", "movies").
 */
function singular(t: string): string {
  const fixed = own(PLURAL_EXCEPTIONS, t);
  if (fixed) return fixed;
  if (t.length > 4 && t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.length > 4 && t.endsWith("s") && !KEEP_S.test(t)) return t.slice(0, -1);
  return t;
}

/** Greedy left-to-right compound folding: a token consumed by a compound is not reused for the next pair. */
function foldCompounds(tokens: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const compound = own(COMPOUNDS, `${tokens[i]} ${tokens[i + 1] ?? ""}`);
    if (compound) {
      out.push(compound);
      i++;
    } else out.push(tokens[i] as string);
  }
  return out;
}

// ---------------------------------------------------------------- letters and marks

/** Letters that Unicode decomposition leaves whole, spelt the way ASCII exports write them. */
const LETTER_FOLDS: Readonly<Record<string, string>> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  þ: "th",
  Þ: "Th",
  ı: "i",
};

/**
 * Accent-free text. NFKD splits "ó" into "o" plus a combining mark, which is
 * dropped, and turns compatibility forms into plain ones ("m³" → "m3", "№" →
 * "No", "＄" → "$"); the few letters that do not decompose are spelt out.
 * Without this, "Código" would split into "c" and "digo".
 */
function foldAccents(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[ßẞæÆœŒøØłŁđĐðÐþÞı]/g, (c) => LETTER_FOLDS[c] ?? c);
}

/** A set from themed lines of space-separated words. */
function wordSet(...lines: string[]): ReadonlySet<string> {
  return new Set(lines.join(" ").split(/\s+/).filter(Boolean));
}

/**
 * ISO 4217 codes that are not also English words or common abbreviations:
 * money wherever they stand as a word ("Amount_USD", "adrUsd", "INR").
 */
const CURRENCY_CODES = wordSet(
  "inr usd eur gbp brl aud nzd sgd hkd jpy cny rmb chf sek dkk czk huf zar mxn ars clp uyu",
  "aed qar kwd bhd omr myr thb vnd krw twd idr pkr bdt lkr egp ngn kes ghs uah ils isk bgn hrk",
);
/**
 * Codes that are also words or abbreviations ("TRY", "PEN", "CAD" for
 * computer-aided design, "NOK" for not OK): money only in brackets and
 * capitals, as in "Price (CAD)".
 */
const BRACKETED_CODES = "CAD|TRY|PEN|PHP|SAR|COP|RON|MAD|NOK|PLN|NPR|RUB|AMD";
/**
 * Currency names written out ("Price in Dollars", "Valor em Reais"). Pound is
 * left out (also a weight), as are real, rand and won (English words).
 */
const CURRENCY_WORDS = wordSet(
  "rs rupee rupees paise paisa dollar dollars euro euros sterling yen yuan renminbi reais pesos",
  "franc francs lira lire krona kronor krone kroner zloty forint koruna rouble roubles ruble rubles",
  "hryvnia shekel shekels ringgit rupiah baht dirham dirhams riyal riyals dinar dinars naira taka",
  "cedi cedis shilling shillings kwacha cents",
);

/** True when a word (lower case) is a currency code or name. */
const isCurrencyWord = (w: string): boolean => CURRENCY_CODES.has(w) || CURRENCY_WORDS.has(w);

/**
 * Marks that splitting on punctuation would strip or cut, rewritten as words
 * before that happens:
 * - a slash after a currency means "per": "₹/kg", "Rs./Ltr", "USD/day";
 * - currency signs (any Unicode currency symbol, and "US$", "R$", "HK$"…) and
 *   bracketed codes that double as words ("(CAD)") become "money";
 * - thousands written as zeros ("('000)", "(000s)") become "thousand", but
 *   not the digits of a number ("1,000 impressions");
 * - "N°", "Nº" and "N.º" (número) become "No", which expands to number;
 *   decomposing "º" first would leave "N.o";
 * - mixed-case energy units ("kWh", "MWh") are lowered so the camel-case
 *   split does not cut them into "k" and "Wh".
 */
function markSymbols(s: string): string {
  return s
    .replace(/(\p{Sc}|\b[Rr]s\.?|\b[A-Za-z]{3})\s*\/\s*(?=\p{L})/gu, (m, cur: string) =>
      /^\p{Sc}$/u.test(cur) || /^rs\.?$/i.test(cur) || CURRENCY_CODES.has(cur.toLowerCase())
        ? `${cur} per `
        : m,
    )
    .replace(/\b[A-Z]{1,3}\$/g, " money ")
    .replace(/\p{Sc}/gu, " money ")
    .replace(new RegExp(`\\(\\s*(?:${BRACKETED_CODES})\\s*\\)`, "g"), " money ")
    .replace(/(^|[^0-9,.])['’]?000['’]?s?(?![0-9])/g, "$1 thousand ")
    .replace(/\b([Nn])\s?\.?\s?[°º]\.?/g, " $1o ")
    .replace(/\b(?:kWh|MWh|GWh|kVAh|kVA|kW)\b/g, (m) => ` ${m.toLowerCase()} `);
}

// ---------------------------------------------------------------- scale words, units and phrases

/**
 * A word table from lines of space-separated "word=meaning" pairs, written in
 * the language's own spelling and folded the way headers are (accents
 * dropped, lower case); "+" joins words on either side
 * ("kostenstelle=cost+center", "sq+ft=sqft"). With `umlauts`, ä, ö and ü are
 * also stored as ae, oe and ue, the way German is typed without them
 * ("Rückstand", "Rueckstand").
 */
function wordTable(lines: readonly string[], umlauts = false): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const key = (w: string) => foldAccents(w).toLowerCase().replace(/\+/g, " ");
  for (const line of lines)
    for (const pair of line.split(/\s+/).filter(Boolean)) {
      const [word = "", meaning = ""] = pair.split("=");
      const to = meaning.replace(/\+/g, " ");
      out.set(key(word), to);
      if (umlauts && /[äöü]/.test(word))
        out.set(key(word.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")), to);
    }
  return out;
}

/**
 * Scale words: a header that says "(₹ Cr)" or "(US$ mn)" gives the unit its
 * figures are written in. Bare "k", "m", "b", "t", "mil" and "cr" depend on
 * their neighbours (see readWords).
 */
const SCALE_WORDS = wordTable([
  // crore
  "crore=crore crores=crore crs=crore",
  // lakh
  "lakh=lakh lakhs=lakh lac=lakh lacs=lakh",
  // million
  "mn=million mln=million million=million millions=million mio=million millones=million",
  "milhões=million milioni=million millionen=million",
  // billion
  "bn=billion bln=billion billion=billion billions=billion mrd=billion milliard=billion",
  "milliards=billion miliardi=billion milliarden=billion bilhões=billion",
  // thousand
  "thousand=thousand thousands=thousand tsd=thousand tausend=thousand mille=thousand",
  "milliers=thousand",
]);

/** Scale prefixes fused to a code, as German and Swiss reports write them ("TEUR", "kCHF", "MUSD"). */
const FUSED_SCALE = /^(k|t|m|mn|mio|bn|mrd)(eur|usd|gbp|chf|inr)$/;
const FUSED_SCALE_WORDS: Readonly<Record<string, string>> = {
  k: "thousand",
  t: "thousand",
  m: "million",
  mn: "million",
  mio: "million",
  bn: "billion",
  mrd: "billion",
};

/**
 * Physical units, so a measure in kilograms, litres or square feet says so:
 * role rules read them as quantities, never money. "gm", "qm", "nos" and a
 * bare "l" depend on their neighbours (see readWords); "hr" and "min" stay
 * as written ("HR", minimum).
 */
const UNIT_WORDS = wordTable([
  // mass
  "kg=kg kgs=kg kilo=kg kilos=kg kilogram=kg kilograms=kg kilogramme=kg kilogrammes=kg kilogramo=kg",
  "kilogramos=kg kilogramm=kg gms=gram gram=gram grams=gram gramme=gram grammes=gram grm=gram",
  "grms=gram gramos=gram gramas=gram grammi=gram gramm=gram ton=tonne tons=tonne tonne=tonne",
  "tonnes=tonne mt=tonne mts=tonne tonelada=tonne toneladas=tonne tonnellata=tonne tonnellate=tonne",
  "tonnen=tonne",
  // volume
  "litre=litre litres=litre liter=litre liters=litre ltr=litre ltrs=litre litro=litre litros=litre",
  "litri=litre m3=cubicmetre cbm=cubicmetre kubikmeter=cubicmetre",
  // length
  "km=km kms=km kilometre=km kilometres=km kilometer=km kilometers=km kilómetro=km kilómetros=km",
  "chilometro=km chilometri=km mile=mile miles=mile",
  // area
  "sqft=sqft sft=sqft ft2=sqft sqm=sqm m2=sqm quadratmeter=sqm",
  // energy
  "kwh=kwh",
  // count
  "pcs=piece piece=piece pieces=piece piezas=piece peças=piece pezzi=piece stk=piece stck=piece",
  // time
  "hrs=hour mins=minute",
]);

/**
 * Expressions of two or three words read as one before anything is
 * translated: units written apart ("Sq. Ft."), percent spelt out, a header
 * that lists its own answers ("Paid (Y/N)", "Pago (Sim/Não)" is a flag; "SI
 * No" is left alone, since it is the serial number of Indian sheets), and
 * foreign terms whose words mean something else one by one.
 */
const PHRASES = wordTable([
  // area
  "sq+ft=sqft sq+feet=sqft sq+foot=sqft square+feet=sqft square+foot=sqft sq+m=sqm sq+mt=sqm",
  "sq+mtr=sqm sq+mtrs=sqm sq+metre=sqm sq+meter=sqm sq+metres=sqm sq+meters=sqm square+metre=sqm",
  "square+meter=sqm square+metres=sqm square+meters=sqm",
  // volume
  "cubic+metre=cubicmetre cubic+meter=cubicmetre cubic+metres=cubicmetre cubic+meters=cubicmetre",
  // percent
  "per+cent=percent por+ciento=percent pour+cent=percent per+cento=percent",
  // flags
  "y+n=flag n+y=flag yes+no=flag no+yes=flag true+false=flag t+f=flag sim+nao=flag oui+non=flag",
  "ja+nein=flag haan+nahi=flag han+nahi=flag",
  // terms
  "chiffre+d+affaires=revenue chiffres+d+affaires=revenue chiffre+affaires=revenue",
  "code+postal=postcode codigo+postal=postcode codice+postale=postcode nota+fiscal=invoice",
  "punto+de+venta=store ponto+de+venda=store point+de+vente=store punto+vendita=store",
  "punto+di+vendita=store razon+social=company+name razao+social=company+name",
  "raison+sociale=company+name ragione+sociale=company+name hors+taxe=net hors+taxes=net",
  "toutes+taxes+comprises=gross frais+de+port=shipping+fee",
]);

/** Longest PHRASES key, in words. */
const PHRASE_WORDS = 3;

/** Replaces each PHRASES expression, longest first, with its meaning. */
function foldPhrases(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    let taken = 0;
    for (let n = Math.min(PHRASE_WORDS, words.length - i); n >= 2 && !taken; n--) {
      const meaning = PHRASES.get(words.slice(i, i + n).join(" "));
      if (meaning === undefined) continue;
      out.push(...meaning.split(" "));
      taken = n;
    }
    if (taken) i += taken;
    else out.push(words[i++] as string);
  }
  return out;
}

// ---------------------------------------------------------------- other languages

/** Languages tokenize translates: Spanish, Portuguese, French, German, Italian, Hindi in Latin letters. */
type Lang = "es" | "pt" | "fr" | "de" | "it" | "hi";

/*
 * One table per language, each mapping a word to the English token the rest
 * of Loupe already uses. Words that mean something else in English, or that
 * are ambiguous in their own language, are left out: "data" (date in
 * Portuguese and Italian, data in English) and "nombre" are read from the
 * rest of the header (CONTEXTUAL), "estado" (state or status) and
 * "departamento" (department, region or flat) only tell the language
 * (LANGUAGE_HINTS) and stay as written, so the values decide.
 */

/** Spanish. */
const SPANISH = wordTable([
  // time
  "fecha=date mes=month año=year anio=year semana=week días=days hora=hour minuto=minute",
  "trimestre=quarter periodo=period mensual=monthly anual=annual diario=daily semanal=weekly",
  "vencimiento=due emisión=issue nacimiento=birth",
  // places
  "ciudad=city municipio=city localidad=city provincia=province país=country distrito=district",
  "comarca=district condado=county dirección=address calle=street sucursal=branch tienda=store",
  "almacén=warehouse",
  // money
  "importe=amount monto=amount precio=price costo=cost coste=cost ingresos=revenue",
  "facturación=revenue venta=sale gasto=expense descuento=discount impuesto=tax iva=vat",
  "beneficio=profit ganancia=profit utilidad=profit margen=margin neto=net bruto=gross",
  "saldo=balance pago=payment alquiler=rent arriendo=rent comisión=commission prima=premium",
  "siniestro=claim cuenta=account transacción=transaction movimiento=transaction valor=value",
  "porcentaje=percent tasa=rate presupuesto=budget objetivo=target realizado=actual deuda=debt",
  "préstamo=loan interés=interest crédito=credit débito=debit flete=freight póliza=policy",
  "cobertura=coverage asegurado=insured",
  // trade
  "cantidad=quantity cant=quantity unidad=unit unitario=unit cliente=customer comprador=buyer",
  "producto=product artículo=item categoría=category pedido=order factura=invoice",
  "proveedor=supplier compra=purchase existencias=stock inventario=inventory entrega=delivery",
  "envío=shipping devolución=return reembolso=refund cancelación=cancellation marca=brand",
  "modelo=model talla=size canal=channel campaña=campaign zona=zone agente=agent",
  "vendedor=salesperson publicidad=advertising rebajado=sale rebajada=sale oferta=offer",
  "forma=method método=method modo=mode",
  // names
  "número=number nro=number código=code clave=key identificador=id título=title apellido=lastname",
  "teléfono=phone móvil=mobile celular=mobile correo=email empresa=company compañía=company",
  "usuario=user",
  // people
  "empleado=employee salario=salary sueldo=salary edad=age sexo=gender género=gender",
  "paciente=patient médico=doctor alumno=student estudiante=student curso=course calificación=grade",
  "huésped=guest",
  // states
  "situación=status tipo=type indicador=flag nuevo=new nueva=new descripción=description",
  "comentario=comment observación=comment motivo=reason prioridad=priority asunto=subject",
  "queja=complaint duración=duration retraso=delay demora=delay",
  // operations
  "contenedor=container puerto=port origen=origin destino=destination buque=vessel naviera=carrier",
  "transportista=carrier llegada=arrival salida=departure aduana=customs peso=weight volumen=volume",
  "habitación=room reserva=booking noche=night llamada=call inmueble=property propiedad=property",
  "inquilino=tenant propietario=owner superficie=area máquina=machine turno=shift",
  "producción=production defecto=defect lote=batch",
]);

/** Portuguese (Brazil and Portugal). */
const PORTUGUESE = wordTable([
  // time
  "mês=month ano=year semana=week dias=days hora=hour minuto=minute trimestre=quarter",
  "período=period mensal=monthly anual=annual diário=daily semanal=weekly vencimento=due",
  "emissão=issue nascimento=birth",
  // places
  "cidade=city município=city uf=state país=country região=region regiões=region distrito=district",
  "endereço=address rua=street cep=postcode loja=store filial=branch agência=branch",
  // money
  "valor=value vl=value vlr=value preço=price custo=cost receita=revenue faturamento=revenue",
  "venda=sale despesa=expense desconto=discount imposto=tax icms=tax iva=vat lucro=profit",
  "margem=margin líquido=net líquida=net bruto=gross bruta=gross saldo=balance pagamento=payment",
  "aluguel=rent aluguéis=rent aluguer=rent comissão=commission comissões=commission prêmio=premium",
  "sinistro=claim sinistralidade=loss+ratio apólice=policy segurado=insured corretor=broker",
  "conta=account transação=transaction transações=transaction movimento=transaction",
  "porcentagem=percent percentual=percent orçamento=budget objetivo=target realizado=actual",
  "juros=interest empréstimo=loan crédito=credit débito=debit frete=freight",
  // trade
  "quantidade=quantity qtd=quantity qtde=quantity qt=quantity unidade=unit unitário=unit",
  "cliente=customer comprador=buyer produto=product categoria=category pedido=order fatura=invoice",
  "nf=invoice nfe=invoice fornecedor=supplier compra=purchase estoque=stock entrega=delivery",
  "envio=shipping devolução=return devoluções=return reembolso=refund cancelamento=cancellation",
  "marca=brand modelo=model tamanho=size canal=channel campanha=campaign zona=zone",
  "vendedor=salesperson publicidade=advertising promoção=promotion promoções=promotion oferta=offer",
  "forma=method método=method modo=mode",
  // names
  "número=number código=code título=title nome=name sobrenome=lastname telefone=phone",
  "celular=mobile empresa=company usuário=user",
  // people
  "funcionário=employee colaborador=employee empregado=employee salário=salary demissão=exit",
  "desligamento=exit idade=age sexo=gender gênero=gender paciente=patient médico=doctor",
  "aluno=student estudante=student curso=course hóspede=guest motorista=driver",
  // states
  "situação=status tipo=type indicador=flag novo=new descrição=description comentário=comment",
  "observação=comment observações=comment motivo=reason prioridade=priority",
  // operations
  "quarto=room reserva=booking imóvel=property inquilino=tenant locatário=tenant proprietário=owner",
  "máquina=machine turno=shift produção=production defeito=defect lote=batch veículo=vehicle",
  "viagem=trip peso=weight",
]);

/** French. "Département" is left out: a business unit, or an administrative region of France. */
const FRENCH = wordTable([
  // time
  "mois=month année=year semaine=week jour=day jours=days heure=hour période=period",
  "trimestre=quarter mensuel=monthly annuel=annual quotidien=daily hebdomadaire=weekly échéance=due",
  "naissance=birth embauche=hire",
  // places
  "ville=city commune=city pays=country adresse=address rue=street arrondissement=district",
  "magasin=store boutique=store agence=branch succursale=branch",
  // money
  "montant=amount prix=price coût=cost recettes=revenue vente=sale dépense=expense remise=discount",
  "rabais=discount taxe=tax tva=vat ttc=gross bénéfice=profit marge=margin brut=gross solde=balance",
  "paiement=payment règlement=payment loyer=rent frais=fee sinistre=claim compte=account",
  "valeur=value pourcentage=percent taux=rate objectif=target réalisé=actual foncier=property",
  "foncière=property",
  // trade
  "quantité=quantity qté=quantity unitaire=unit produit=product catégorie=category commande=order",
  "facture=invoice fournisseur=supplier achat=purchase acheteur=buyer livraison=delivery",
  "retour=return remboursement=refund annulation=cancellation marque=brand modèle=model taille=size",
  "couleur=color campagne=campaign moyen=method",
  // names
  "numéro=number titre=title nom=name prénom=firstname société=company entreprise=company",
  "utilisateur=user",
  // people
  "employé=employee salarié=employee salaire=salary effectif=headcount ancienneté=tenure",
  "sexe=gender médecin=doctor étudiant=student élève=student cours=course locataire=tenant",
  "propriétaire=owner équipe=team",
  // states
  "statut=status nouveau=new nouvelle=new commentaire=comment remarque=comment objet=subject",
  "sujet=subject motif=reason priorité=priority durée=duration délai=delay indicateur=flag",
  "chambre=room",
]);

/**
 * German whole words. Compounds ("Kundennummer", "Rechnungsbetrag") are split
 * into these and GERMAN_PARTS by splitGerman.
 */
const GERMAN = wordTable(
  [
    // time
    "datum=date monat=month monate=month jahr=year jahre=year woche=week wochen=week tage=days",
    "stunde=hour stunden=hour minuten=minute quartal=quarter zeitraum=period periode=period zeit=time",
    "monatlich=monthly jährlich=annual täglich=daily wöchentlich=weekly fälligkeit=due",
    // places
    "stadt=city ort=city gemeinde=city kreis=district landkreis=district bezirk=district",
    "bundesland=state provinz=province staat=country straße=street adresse=address plz=postcode",
    "postleitzahl=postcode standort=location filiale=branch niederlassung=branch",
    // money
    "betrag=amount preis=price preise=price kosten=cost umsatz=revenue umsätze=revenue erlös=revenue",
    "erlöse=revenue verkauf=sale rabatt=discount nachlass=discount steuer=tax mwst=vat ust=vat",
    "mehrwertsteuer=vat umsatzsteuer=vat gewinn=profit verlust=loss marge=margin summe=total",
    "gesamt=total gesamtsumme=total netto=net brutto=gross saldo=balance zahlung=payment miete=rent",
    "kaltmiete=rent warmmiete=gross+rent nebenkosten=service+charge kaution=deposit",
    "rückstand=outstanding gebühr=fee prämie=premium schaden=claim konto=account",
    "transaktion=transaction buchung=booking wert=value prozent=percent anteil=share satz=rate",
    "zins=interest zinsen=interest kredit=loan darlehen=loan versicherung=insurance",
    "abweichung=variance kostenstelle=cost+center durchschnitt=average je=per",
    // trade
    "menge=quantity mengen=quantity anzahl=count einheit=unit kunde=customer kunden=customer",
    "kundin=customer käufer=buyer produkt=product artikel=item kategorie=category",
    "warengruppe=category bestellung=order auftrag=order rechnung=invoice lieferant=supplier",
    "einkauf=purchase bestand=stock lagerbestand=stock inventar=inventory lieferung=delivery",
    "versand=shipping sendung=shipping retoure=return rücksendung=return erstattung=refund",
    "rückerstattung=refund stornierung=cancellation storno=cancellation eingang=received marke=brand",
    "modell=model größe=size farbe=color kanal=channel kampagne=campaign angebot=offer beleg=document",
    "vertrag=contract projekt=project aufgabe=task",
    // names
    "nummer=number kennung=id schlüssel=key kennzeichen=flag titel=title vorname=firstname",
    "nachname=lastname telefon=phone firma=company unternehmen=company benutzer=user",
    // people
    "mitarbeiter=employee gehalt=salary lohn=wage abteilung=department alter=age geschlecht=gender",
    "vorgesetzter=manager mieter=tenant vermieter=landlord arzt=doctor schüler=student kurs=course",
    "fahrer=driver urlaub=leave",
    // states
    "neu=new neue=new beschreibung=description kommentar=comment bemerkung=comment anmerkung=comment",
    "ziel=target",
    // operations
    "wohnung=flat fläche=area zimmer=room objekt=property maschine=machine schicht=shift",
    "produktion=production fehler=defect ausschuss=scrap fahrzeug=vehicle fahrt=trip",
  ],
  true,
);

/**
 * German stems found only inside compounds, with the meaning they have there:
 * "Jahres-" is annual (Jahresgehalt), "Liefer-" delivery (Lieferdatum),
 * "Personal-" staff (Personalnummer). "Soll" and "Ist" are the target and
 * actual columns of a plan/actual sheet (Sollmiete, Istumsatz).
 */
const GERMAN_PARTS = wordTable(
  [
    // stems
    "jahres=annual monats=monthly tages=daily wochen=weekly liefer=delivery bestell=order",
    "personal=employee eintritt=joining austritt=exit geburt=birth miet=rent art=type typ=type",
    "weise=method methode=method nr=number id=id code=code name=name tag=day zahl=count gruppe=group",
    "klasse=class soll=target ist=actual plan=plan start=start beginn=start ende=end ware=product",
    "waren=product lager=warehouse status=status stück=piece einzel=unit normal=regular",
    "firmen=company arbeit=work krankheit=sick ort=city",
  ],
  true,
);

/** Italian. */
const ITALIAN = wordTable([
  // time
  "mese=month mesi=month anno=year anni=year settimana=week settimane=week giorno=day giorni=days",
  "periodo=period trimestre=quarter mensile=monthly annuale=annual giornaliero=daily",
  "settimanale=weekly scadenza=due emissione=issue nascita=birth",
  // places
  "città=city comune=city provincia=province regione=region paese=country nazione=nation",
  "indirizzo=address negozio=store negozi=store filiale=branch magazzino=warehouse",
  // money
  "importo=amount importi=amount prezzo=price prezzi=price costo=cost costi=cost ricavo=revenue",
  "ricavi=revenue fatturato=revenue vendita=sale vendite=sale spesa=expense spese=expense",
  "sconto=discount sconti=discount imposta=tax iva=vat utile=profit profitto=profit margine=margin",
  "totale=total netto=net lordo=gross saldo=balance pagamento=payment affitto=rent",
  "commissione=commission premio=premium sinistro=claim conto=account transazione=transaction",
  "valore=value percentuale=percent tasso=rate obiettivo=target effettivo=actual consuntivo=actual",
  "interesse=interest",
  // trade
  "quantità=quantity unitario=unit cliente=customer clienti=customer acquirente=buyer",
  "prodotto=product prodotti=product articolo=item articoli=item categoria=category ordine=order",
  "ordini=order fattura=invoice fatture=invoice fornitore=supplier fornitori=supplier",
  "acquisto=purchase giacenza=stock consegna=delivery spedizione=shipping reso=return",
  "rimborso=refund cancellazione=cancellation marca=brand modello=model taglia=size colore=color",
  "canale=channel campagna=campaign pubblicità=advertising offerta=offer scontato=sale",
  "normale=regular metodo=method modo=mode modalità=mode",
  // names
  "numero=number codice=code titolo=title nome=name cognome=lastname telefono=phone azienda=company",
  "società=company utente=user",
  // people
  "dipendente=employee dipendenti=employee stipendio=salary reparto=department sesso=gender",
  "paziente=patient medico=doctor studente=student corso=course",
  // states
  "tipo=type nuovo=new nuova=new descrizione=description commento=comment motivo=reason",
  "priorità=priority indicatore=flag",
]);

/** Hindi written in Latin letters, as Indian sheets name columns ("Gaadi No", "Bhada", "Baaki"). */
const HINDI = wordTable([
  // time
  "tarikh=date tareekh=date tarik=date mahina=month mahine=month saal=year hafta=week ghanta=hour",
  "samay=time",
  // places
  "shahar=city shehar=city gaon=village gaanv=village zila=district jila=district zilla=district",
  "rajya=state desh=country kshetra=region pata=address dukaan=store dukan=store shakha=branch",
  // money
  "rakam=amount raqam=amount rashi=amount keemat=price kimat=price qeemat=price daam=price",
  "mulya=value moolya=value kul=total jama=deposit udhaar=credit udhar=credit baki=balance",
  "baaki=balance bakaya=outstanding bhada=freight bhaada=freight kiraya=rent kiraaya=rent",
  "kharcha=expense kharch=expense kharche=expense lagat=cost laagat=cost aamdani=income",
  "amdani=income vetan=salary tankhwah=salary tankha=salary munafa=profit munaafa=profit",
  "labh=profit nuksan=loss nuksaan=loss bhugtan=payment byaj=interest byaaj=interest kist=emi",
  "kisht=emi khata=account lenden=transaction shulk=fee beema=insurance bima=insurance",
  // trade
  "grahak=customer graahak=customer bikri=sale kharid=purchase kharidi=purchase matra=quantity",
  "maatra=quantity gaadi=vehicle gadi=vehicle gaddi=vehicle",
  // people
  "naam=name karmachari=employee vibhag=department chalak=driver chaalak=driver umar=age umr=age",
  "aayu=age",
  // states
  "vivaran=description tippani=comment sthiti=status lakshya=target bajat=budget vastavik=actual",
]);

const LANGUAGE_TABLES: ReadonlyArray<readonly [Lang, ReadonlyMap<string, string>]> = [
  ["es", SPANISH],
  ["pt", PORTUGUESE],
  ["fr", FRENCH],
  ["de", GERMAN],
  ["it", ITALIAN],
  ["hi", HINDI],
];

/** A translated word: its English token(s) and the languages it belongs to. */
interface Translation {
  to: string;
  langs: Lang[];
}

/** One reading of a CONTEXTUAL word; `alone` marks the reading of a header that is that word alone. */
interface ContextualReading {
  langs: readonly Lang[];
  to: string;
  alone?: boolean;
}

/**
 * Words whose meaning depends on the rest of the header, with the reading
 * each language gives. Translated only when the header's other words show
 * one of those languages (languageOf): "Data da venda" is a date, "Data
 * Usage" stays data; "Cod Cliente" is a code, "COD Amount" stays cash on
 * delivery; "Nombre del cliente" is a name, "Nombre de commandes" a number;
 * "Precio normal" is the regular price; "Umsatz Ist" is the actual figure,
 * "Time (IST)" a time zone. "Nombre" alone is Spanish for name, since French
 * names a count "Nombre de …".
 */
const CONTEXTUAL: ReadonlyMap<string, readonly ContextualReading[]> = new Map<
  string,
  readonly ContextualReading[]
>([
  ["data", [{ langs: ["pt", "it"], to: "date" }]],
  ["cod", [{ langs: ["es", "pt", "it"], to: "code" }]],
  ["dia", [{ langs: ["es", "pt"], to: "day" }]],
  ["meta", [{ langs: ["es", "pt"], to: "target" }]],
  [
    "nombre",
    [
      { langs: ["es"], to: "name", alone: true },
      { langs: ["fr"], to: "number" },
    ],
  ],
  ["normal", [{ langs: ["es", "pt", "fr", "it"], to: "regular" }]],
  ["expedition", [{ langs: ["fr"], to: "shipping" }]],
  ["ist", [{ langs: ["de"], to: "actual" }]],
  ["soll", [{ langs: ["de"], to: "target" }]],
  ["art", [{ langs: ["de"], to: "type" }]],
  ["land", [{ langs: ["de"], to: "country" }]],
  ["laden", [{ langs: ["de"], to: "store" }]],
  ["lager", [{ langs: ["de"], to: "warehouse" }]],
  ["stuck", [{ langs: ["de"], to: "piece" }]],
  ["tag", [{ langs: ["de"], to: "day" }]],
]);

/** Words that show a header's language but stay untranslated, because they are ambiguous within it. */
const LANGUAGE_HINTS: ReadonlyMap<string, readonly Lang[]> = new Map<string, readonly Lang[]>([
  ["estado", ["es", "pt"]],
  ["departamento", ["es", "pt"]],
  ["departement", ["fr"]],
  ["etat", ["fr"]],
  ["stato", ["it"]],
  ["bairro", ["pt"]],
  ["barrio", ["es"]],
  ["setor", ["pt"]],
  ["nota", ["es", "pt", "it"]],
  ["taxa", ["pt"]],
  ["tarifa", ["es", "pt"]],
  ["cuota", ["es"]],
  ["renta", ["es"]],
  ["admissao", ["pt"]],
  ["ingreso", ["es"]],
  ["comercial", ["es", "pt"]],
]);

/**
 * Articles and prepositions of other languages, with the languages they
 * belong to. Like "of", they are skipped when names are compared, but only
 * between two words, where they sit in a header ("Data da venda", "Nombre del
 * cliente"): at either end the same letters are usually an abbreviation
 * ("DO number" for a delivery order, "LOS" for length of stay, "PAR bucket").
 */
const FOREIGN_STOPWORDS: ReadonlyMap<string, readonly Lang[]> = new Map<string, readonly Lang[]>([
  ["de", ["es", "pt", "fr"]],
  ["da", ["pt", "it"]],
  ["do", ["pt"]],
  ["das", ["pt", "de"]],
  ["dos", ["pt", "es"]],
  ["del", ["es", "it"]],
  ["la", ["es", "fr", "it"]],
  ["el", ["es"]],
  ["los", ["es"]],
  ["las", ["es"]],
  ["le", ["fr"]],
  ["les", ["fr"]],
  ["du", ["fr"]],
  ["des", ["fr"]],
  ["der", ["de"]],
  ["die", ["de"]],
  ["und", ["de"]],
  ["y", ["es"]],
  ["e", ["pt", "it"]],
  ["et", ["fr"]],
  ["en", ["es", "fr"]],
  ["em", ["pt"]],
  ["por", ["es", "pt"]],
  ["para", ["es", "pt"]],
  ["pour", ["fr"]],
  ["par", ["fr"]],
  ["con", ["es", "it"]],
  ["com", ["pt"]],
  ["avec", ["fr"]],
  ["mit", ["de"]],
  ["von", ["de"]],
  ["zum", ["de"]],
  ["zur", ["de"]],
  ["au", ["fr"]],
  ["aux", ["fr"]],
  ["di", ["it"]],
  ["della", ["it"]],
  ["delle", ["it"]],
  ["dei", ["it"]],
  ["degli", ["it"]],
  ["dello", ["it"]],
  ["ka", ["hi"]],
  ["ki", ["hi"]],
  ["ke", ["hi"]],
]);

const TRANSLATIONS = new Map<string, Translation>();
const CONFLICTS = new Set<string>();
for (const [lang, table] of LANGUAGE_TABLES)
  for (const [word, to] of table) {
    const seen = TRANSLATIONS.get(word);
    if (!seen) TRANSLATIONS.set(word, { to, langs: [lang] });
    else if (seen.to === to) seen.langs.push(lang);
    else CONFLICTS.add(word);
  }
// A word two tables read differently, or that another table already reads, is never translated:
// guessing between two meanings would be inventing one.
for (const [word, { to }] of TRANSLATIONS) {
  const other =
    own(ABBREVIATIONS, word) ??
    UNIT_WORDS.get(word) ??
    SCALE_WORDS.get(word) ??
    (isCurrencyWord(word) ? "money" : null);
  if (CONTEXTUAL.has(word) || (other !== null && other !== to)) CONFLICTS.add(word);
}
for (const word of CONFLICTS) TRANSLATIONS.delete(word);

/**
 * Words two tables read differently. They are left untranslated; the list
 * exists so tests/names-vocabulary.test.ts can keep the tables consistent.
 */
export function translationConflicts(): string[] {
  return [...CONFLICTS].sort();
}

/**
 * The translation of a word, trying it as written, then without a plural
 * "-s" or "-es" ("clientes" → cliente, "ciudades" → ciudad). Other plurals
 * ("prezzi", "Kunden") are listed in the tables.
 */
function translation(word: string): Translation | undefined {
  const exact = TRANSLATIONS.get(word);
  if (exact || word.length < 4 || !word.endsWith("s")) return exact;
  return (
    TRANSLATIONS.get(word.slice(0, -1)) ??
    (word.endsWith("es") ? TRANSLATIONS.get(word.slice(0, -2)) : undefined)
  );
}

/**
 * The languages a header is most likely written in: each translated word,
 * language hint and in-between stopword votes for its languages, and the
 * languages with the most votes win. Empty for an English header.
 */
function languageOf(words: readonly string[]): ReadonlySet<Lang> {
  const votes = new Map<Lang, number>();
  words.forEach((w, i) => {
    const between = i > 0 && i < words.length - 1 && w.length > 1;
    const langs =
      translation(w)?.langs ?? LANGUAGE_HINTS.get(w) ?? (between ? FOREIGN_STOPWORDS.get(w) : undefined);
    for (const lang of langs ?? []) votes.set(lang, (votes.get(lang) ?? 0) + 1);
  });
  const top = Math.max(0, ...votes.values());
  return new Set([...votes].filter(([, n]) => top > 0 && n === top).map(([lang]) => lang));
}

/**
 * A CONTEXTUAL word's reading in a header written in `langs`, or in a header
 * of that word `alone`; as written when no reading or several fit.
 */
function contextual(word: string, langs: ReadonlySet<Lang>, alone: boolean): string {
  const readings = CONTEXTUAL.get(word) ?? [];
  const fits = alone
    ? readings.filter((r) => r.alone)
    : readings.filter((r) => r.langs.some((l) => langs.has(l)));
  return fits.length === 1 ? (fits[0] as ContextualReading).to : word;
}

// ---------------------------------------------------------------- reading each word

/** Weight words that make a bare "gm" grams ("Net Wt (gm)"), not gross margin ("GM %", "Avg GM"). */
const WEIGHT_WORDS = wordSet("weight wt wgt wght pack packing size content peso gewicht poids");
/** Money words that make "HT" the French hors taxes, net of tax ("Total HT", "Prix HT"), not a height. */
const HT_MONEY = wordSet(
  "total amount price value cost revenue sale fee tax discount payment money net gross subtotal charge rent",
);

/**
 * Every word of a header as canonical tokens, read with its neighbours:
 * currency words become "money"; scale and unit words are named; foreign
 * words are translated; abbreviations expand. A few short words are read
 * from what stands next to them, because alone they are ambiguous:
 * - "k" is thousand beside a currency or at the end ("Revenue (K)");
 *   "m"/"mm", "b" and "mil" are million, billion and thousand only beside a
 *   currency ("$M", "€m", "R$ mil"), so "Height (m)" keeps its metres; "t" is
 *   thousand only right before one ("T€");
 * - "cr" is crore, but credit in a debit/credit header ("Dr/Cr");
 * - "l" is litres unless the header has other single letters ("P&L", "S/M/L");
 * - "gm" is grams only at the end of a weight header; "qm" (Quadratmeter) and
 *   "nos" (pieces) only at the end ("QM Status" is quality management);
 * - "ht" is net of tax in a money or French header, else height.
 */
function readWords(words: readonly string[]): string[] {
  const last = words.length - 1;
  const money = words.map((w) => w === "money" || isCurrencyWord(w));
  // The nearest word on one side, skipping English stopwords ("$ in M").
  const near = (i: number, step: 1 | -1): number => {
    let j = i + step;
    while (j >= 0 && j <= last && STOPWORDS.has(words[j] as string)) j += step;
    return j;
  };
  const moneyAt = (j: number): boolean => j >= 0 && j <= last && money[j] === true;
  const besideMoney = (i: number): boolean => moneyAt(near(i, -1)) || moneyAt(near(i, 1));
  const letters = words.filter((w) => /^[a-z]$/.test(w)).length;

  // First the words that need nothing beyond their neighbours; null for those read from the language.
  const read = (w: string, i: number): string | null => {
    if (money[i]) return "money";
    const fused = FUSED_SCALE.exec(w);
    if (fused) return `${FUSED_SCALE_WORDS[fused[1] as string]} money`;
    const scale = SCALE_WORDS.get(w);
    if (scale) return scale;
    switch (w) {
      case "k":
        if (besideMoney(i) || (i === last && i > 0)) return "thousand";
        break;
      case "m":
      case "mm":
        if (besideMoney(i)) return "million";
        break;
      case "b":
        if (besideMoney(i)) return "billion";
        break;
      case "t":
        if (moneyAt(near(i, 1))) return "thousand";
        break;
      case "mil":
        if (besideMoney(i)) return "thousand";
        break;
      case "cr":
        return words.includes("dr") ? "credit" : "crore";
      case "l":
        if (letters === 1 && last > 0) return "litre";
        break;
      case "gm":
        if (i === last && i > 0 && words.some((x) => WEIGHT_WORDS.has(x))) return "gram";
        break;
      case "qm":
        if (i === last && i > 0) return "sqm";
        break;
      case "nos":
        if (i === last && i > 0) return "piece";
        break;
      case "ht":
        return null;
    }
    const unit = UNIT_WORDS.get(w);
    if (unit) return unit;
    const translated = translation(w);
    if (translated) return translated.to;
    if (CONTEXTUAL.has(w)) return null;
    return own(ABBREVIATIONS, w) ?? w;
  };
  const first = words.map(read);
  const langs = languageOf(words);
  const moneyContext = first.some((x) => x !== null && x.split(" ").some((t) => HT_MONEY.has(t)));
  return words.flatMap((w, i) => {
    const direct = first[i] ?? null;
    if (direct !== null) return direct.split(" ");
    if (w === "ht") return [moneyContext || langs.has("fr") ? "net" : "height"];
    return contextual(w, langs, last === 0).split(" ");
  });
}

// ---------------------------------------------------------------- fused words

/**
 * Words that end a fused English header: the noun it is about, as in
 * "ORDERNUMBER", "TUITIONFEE", "acttotalcost" (two-letter ones are the only
 * pieces shorter than three letters). Not "age" or "work", which end too
 * many ordinary words (mileage, package, network).
 */
const SEGMENT_HEADS = wordSet(
  // identifiers and labels
  "id no nr num number code key ref name title type status flag",
  // amounts and measures
  "total amount amt cost price fee value val qty quantity count cnt rate pct percent each",
  "sales sale revenue profit margin discount tax balance payment charge spend budget target",
  "salary income expense deposit credit debit premium claim loan interest rent fare bonus",
  "commission tuition freight unit units size weight volume limit",
  // classifications
  "category class group level score rank rating tier mode method plan line source channel segment",
  // time
  "date time year month week day hour minute quarter period duration start end finish",
  // entities, places and contact details
  "shipping delivery refund return order invoice customer product item sku store branch owner",
  "address city state country region zone center centre email phone gender",
  // text
  "description desc note comment reason",
  // states an order reaches
  "ordered shipped delivered received sold paid returned cancelled",
  // currency codes and units written onto the end
  "inr usd eur gbp aud sgd kg km ltr pcs kwh",
);
/**
 * Words that may start or sit inside a fused English header: entities and the
 * qualifiers analysts put before them.
 */
const SEGMENT_PIECES = wordSet(
  // qualifiers
  "act actual annual avg average base close closing current daily due end est estimated expected",
  "expiry extended final first fiscal full gross high hourly initial join joining last late low max",
  "min monthly net new next old open opening other paid planned prev previous primary prior repeat",
  "sched scheduled sell selling start weekly yearly ytd mtd",
  // amounts
  "amount amt bill billing budget cash commission cost credit debit deposit discount expense fee",
  "income interest loan number price profit qty quantity rate refund rent revenue tax total tuition",
  "value",
  // entities
  "account acct address agent asset birth booking branch brand business call campaign card cart case",
  "category channel city claim class client company contact contract country coupon course cust",
  "customer date day deal delivery department dept device doc document driver emp employee event",
  "freight group guest hire home hotel invoice item job key lead line list location manager market member",
  "merchant month night order origin owner page parent partner patient pay payment period plan policy",
  "postal prod product project promo property purchase quarter ref region release report request",
  "return room route sale sales service session ship shipping shop sku source staff state status",
  "stock store student subscription supplier support target task team ticket time title trade",
  "transaction trip type unit user vehicle vendor visit warehouse week work year",
);
/** Words the segmenter could split but that are words as they stand. */
const WHOLE_WORDS = wordSet(
  "weekday weekend birthday baseline timeline dateline deadline keynote payphone fullname",
);

/**
 * "acttotalcost" → act, total, cost: the fewest pieces (at most four) that
 * cover every letter, each a known word, the last one a head noun; null
 * otherwise. Ties keep the longer first piece.
 */
function segmentFused(word: string): string[] | null {
  const n = word.length;
  const best = new Array<string[] | null>(n + 1).fill(null);
  best[n] = [];
  for (let i = n - 1; i >= 0; i--)
    for (let j = n; j - i >= 2; j--) {
      const rest = best[j];
      const piece = word.slice(i, j);
      if (!rest || !(j === n ? SEGMENT_HEADS.has(piece) : SEGMENT_PIECES.has(piece))) continue;
      const current = best[i];
      if (!current || rest.length + 1 < current.length) best[i] = [piece, ...rest];
    }
  const out = best[0];
  return out && out.length >= 2 && out.length <= 4 ? out : null;
}

/** German stems a compound may be built from: whole words of four letters or more, and GERMAN_PARTS. */
const GERMAN_STEMS: ReadonlyMap<string, string> = new Map([
  ...[...GERMAN].filter(([w]) => w.length >= 4),
  ...GERMAN_PARTS,
]);
const GERMAN_STEM_LENGTH = Math.max(...[...GERMAN_STEMS.keys()].map((k) => k.length));
/** Linking letters German puts between the parts of a compound (Rechnung-s-betrag, Kunde-n-nummer). */
const GERMAN_LINKS = ["", "s", "es", "n", "en", "e"] as const;
/** Stems spelt like English words, which cannot on their own show that a word is German. */
const GERMAN_ENGLISH = wordSet("alter personal normal");

/**
 * "Kundennummer" → customer, number; "Rechnungsbetrag" → invoice, amount.
 * The cheapest split into GERMAN_STEMS (ten points a stem, one a linking
 * letter, so "Jahres" is read as annual rather than "Jahr" plus "es"), kept
 * only when one stem of four letters or more is unmistakably German: "artist"
 * would otherwise be "Art" plus "ist".
 */
function splitGerman(word: string): string[] | null {
  const n = word.length;
  const best = new Array<{ parts: string[]; cost: number } | null>(n + 1).fill(null);
  best[n] = { parts: [], cost: 0 };
  for (let i = n - 1; i >= 0; i--)
    for (let j = Math.min(n, i + GERMAN_STEM_LENGTH); j - i >= 2; j--) {
      const stem = word.slice(i, j);
      if (!GERMAN_STEMS.has(stem)) continue;
      for (const link of GERMAN_LINKS) {
        const k = j + link.length;
        if (link && (k >= n || !word.startsWith(link, j))) continue;
        const rest = best[k];
        if (!rest) continue;
        const cost = rest.cost + 10 + link.length;
        const current = best[i];
        if (!current || cost < current.cost) best[i] = { parts: [stem, ...rest.parts], cost };
      }
    }
  const out = best[0];
  if (!out || out.parts.length < 2) return null;
  const german = out.parts.some((p) => p.length >= 4 && GERMAN_STEMS.get(p) !== p && !GERMAN_ENGLISH.has(p));
  return german ? out.parts.flatMap((p) => (GERMAN_STEMS.get(p) ?? "").split(" ").filter(Boolean)) : null;
}

let knownWords: ReadonlySet<string> | null = null;

/**
 * True for words tokenize reads as they stand, so it never splits them. The
 * set is built on first use, once every table exists.
 */
function isKnown(word: string): boolean {
  knownWords ??= new Set([
    ...Object.keys(ABBREVIATIONS),
    ...Object.values(ABBREVIATIONS).flatMap((v) => v.split(" ")),
    ...Object.values(COMPOUNDS),
    ...[...PHRASES.values()].flatMap((v) => v.split(" ")),
    ...TRANSLATIONS.keys(),
    ...[...TRANSLATIONS.values()].flatMap((t) => t.to.split(" ")),
    ...CONTEXTUAL.keys(),
    ...LANGUAGE_HINTS.keys(),
    ...UNIT_WORDS.keys(),
    ...UNIT_WORDS.values(),
    ...SCALE_WORDS.keys(),
    ...SCALE_WORDS.values(),
    ...CURRENCY_CODES,
    ...CURRENCY_WORDS,
    ...GENERIC_TOKENS,
    ...STOPWORDS,
    ...FOREIGN_STOPWORDS.keys(),
    ...SEGMENT_PIECES,
    ...SEGMENT_HEADS,
    ...WHOLE_WORDS,
  ]);
  return knownWords.has(word) || knownWords.has(singular(word)) || translation(word) !== undefined;
}

/**
 * One word of a header as lower-case tokens. A word of seven letters or more
 * that tokenize does not know may be several words run together: written
 * all in capitals or all in lower case it is split into known English words
 * (segmentFused: "ACTTOTALCOST", "tuitionfee"); in any case it may be a
 * German compound (splitGerman). Trailing digits stay a token of their own
 * ("ADDRESSLINE1" → address, line, 1).
 */
function splitWord(raw: string): string[] {
  const lower = raw.toLowerCase();
  const m = /^([a-z]{7,})(\d*)$/.exec(lower);
  if (!m || isKnown(m[1] as string)) return [lower];
  const letters = m[1] as string;
  const fusedCase = raw === lower || raw === raw.toUpperCase();
  const parts =
    (fusedCase ? (segmentFused(letters) ?? segmentFused(singular(letters))) : null) ?? splitGerman(letters);
  if (!parts) return [lower];
  return m[2] ? [...parts, m[2]] : parts;
}

// ---------------------------------------------------------------- tokenize

/**
 * "OrderDate" → ["order","date"]; "cust_ID" → ["customer","id"]; "Discount %"
 * → ["discount","percent"]; "Código Cliente" → ["code","customer"]; "AUM (₹ Cr)"
 * → ["aum","money","crore"]; "Kundennummer" → ["customer","number"].
 *
 * Steps, in this order because each needs what the one before leaves:
 * 1. rewrite currency signs, "N.º" and other marks as words (markSymbols),
 *    while they are still as written;
 * 2. fold accents (foldAccents), so accented letters stay inside their word;
 * 3. isolate % and #, split camelCase and acronym boundaries ("HTTPServer" →
 *    http, server) and split on anything else that is not a letter or digit;
 * 4. split fused English words and German compounds (splitWord), while the
 *    word's own capitals still show whether it was written fused;
 * 5. read multi-word expressions ("Sq. Ft.", "Y/N") and fold compounds on the
 *    raw words ("Pin Code" → pincode);
 * 6. read each word with its neighbours (readWords): money, scale and unit
 *    words, translations, abbreviations, and the ambiguous few;
 * 7. singularise, fold compounds again ("Sub Cat" → subcategory) and keep one
 *    "money" where several marks stood together ("₹ INR").
 */
export function tokenize(name: string): string[] {
  const spaced = foldAccents(markSymbols(name))
    .replace(/%/g, " % ")
    .replace(/#/g, " # ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const words = spaced
    .split(/[^A-Za-z0-9%#]+/)
    .filter(Boolean)
    .flatMap(splitWord);
  const tokens = foldCompounds(readWords(foldCompounds(foldPhrases(words))).map(singular));
  return tokens.filter((t, i) => t !== "money" || tokens[i - 1] !== "money");
}

/** Currency signs and their ISO codes; prefixed dollars come first, so "R$" is not read as "$". */
const SIGN_CODES: ReadonlyArray<readonly [string, string]> = [
  ["US$", "USD"],
  ["AU$", "AUD"],
  ["CA$", "CAD"],
  ["NZ$", "NZD"],
  ["HK$", "HKD"],
  ["SG$", "SGD"],
  ["NT$", "TWD"],
  ["MX$", "MXN"],
  ["AR$", "ARS"],
  ["R$", "BRL"],
  ["A$", "AUD"],
  ["C$", "CAD"],
  ["S$", "SGD"],
  ["₹", "INR"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["₩", "KRW"],
  ["₽", "RUB"],
  ["₺", "TRY"],
  ["₪", "ILS"],
  ["₫", "VND"],
  ["₱", "PHP"],
  ["฿", "THB"],
  ["₦", "NGN"],
  ["₴", "UAH"],
  ["₸", "KZT"],
  ["$", "USD"],
];
/** Currency words and the code each names ("in Rupees", "Valor em Reais"). */
const WORD_CODES: Readonly<Record<string, string>> = {
  rs: "INR",
  rupee: "INR",
  rupees: "INR",
  paise: "INR",
  paisa: "INR",
  dollar: "USD",
  dollars: "USD",
  euro: "EUR",
  euros: "EUR",
  sterling: "GBP",
  yen: "JPY",
  yuan: "CNY",
  renminbi: "CNY",
  rmb: "CNY",
  reais: "BRL",
};

/**
 * The currency a header names, as an ISO code: a sign ("Price (₹)", "R$"),
 * a code ("Amount_USD", "Fare (CAD)") or a currency word ("in Rupees").
 * tokenize folds all of these into the one token "money", so a caller that
 * needs to know which currency (the dataset currency in profile.ts) reads
 * the header here.
 */
export function nameCurrency(name: string): string | undefined {
  const folded = foldAccents(name);
  const sign = SIGN_CODES.find(([s]) => folded.includes(s));
  if (sign) return sign[1];
  const bracketed = new RegExp(`\\(\\s*(${BRACKETED_CODES})\\s*\\)`).exec(folded);
  if (bracketed) return bracketed[1];
  const words = folded
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .flatMap(splitWord);
  for (const w of words) {
    const code = own(WORD_CODES, w) ?? (CURRENCY_CODES.has(w) ? w.toUpperCase() : undefined);
    if (code) return code;
  }
  return undefined;
}

// ---------------------------------------------------------------- similarity

/** A token list prepared for nameSimilarity: its joined forms and its content words (stopwords removed). */
interface PreparedName {
  tokens: readonly string[];
  joined: string;
  compact: string;
  content: readonly string[];
  contentSet: ReadonlySet<string>;
}

function prepare(tokens: readonly string[]): PreparedName {
  const c = content(tokens);
  return { tokens, joined: tokens.join(" "), compact: tokens.join(""), content: c, contentSet: new Set(c) };
}

const phraseCache = new Map<string, PreparedName>();
const columnCache = new WeakMap<readonly string[], PreparedName>();

/** A registry phrase tokenised and prepared once; dropped wholesale past 50,000 phrases. */
function preparedPhrase(phrase: string): PreparedName {
  let p = phraseCache.get(phrase);
  if (!p) {
    if (phraseCache.size >= 50_000) phraseCache.clear();
    p = prepare(tokenize(phrase));
    phraseCache.set(phrase, p);
  }
  return p;
}

/** A column's token list prepared once per array (ColumnProfile.tokens is compared with every synonym). */
function preparedTokens(tokens: readonly string[]): PreparedName {
  let p = columnCache.get(tokens);
  if (!p) {
    p = prepare(tokens);
    columnCache.set(tokens, p);
  }
  return p;
}

/**
 * tokenize, memoised: registry labels and synonyms are compared against every
 * column of every upload, so each is tokenised once. The result is shared, so
 * it is read-only.
 */
export function phraseTokens(phrase: string): readonly string[] {
  return preparedPhrase(phrase).tokens;
}

/** Canonical tokens joined by single spaces. */
export function normalizedName(name: string): string {
  return tokenize(name).join(" ");
}

/** Jaro–Winkler similarity in [0, 1], with the standard 0.1 prefix bonus over up to 4 characters. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const window = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false);
  const mb = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(lb - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = true;
      mb[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / la + m / lb + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, la, lb); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Function words ignored when comparing token sets, so "date of admission" matches "admission date". */
const STOPWORDS: ReadonlySet<string> = new Set([
  "of",
  "the",
  "a",
  "an",
  "in",
  "on",
  "at",
  "by",
  "for",
  "to",
  "from",
  "and",
  "or",
  "with",
]);

/**
 * Tokens that qualify a name without saying what it is about: ID and label
 * words, time words, generic measures and states, units, currency and scale.
 * A partial match needs a shared token outside this set and may only leave
 * out tokens from it, so "Market Rent" never reaches "market value" and "Loan
 * Status" never reaches "bad loan" on one shared word. Bare numbers
 * ("Address Line 1") count as generic too (isGeneric).
 */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "id",
  "number",
  "code",
  "key",
  "name",
  "title",
  "label",
  "reference",
  "date",
  "time",
  "datetime",
  "timestamp",
  "day",
  "days",
  "week",
  "month",
  "year",
  "quarter",
  "hour",
  "minute",
  "period",
  "amount",
  "value",
  "total",
  "count",
  "average",
  "rate",
  "percent",
  "ratio",
  "score",
  "level",
  "type",
  "status",
  "category",
  "class",
  "group",
  "kind",
  "description",
  "detail",
  "info",
  "data",
  "new",
  "current",
  "last",
  "first",
  "final",
  "actual",
  "gross",
  "net",
  "is",
  "has",
  "was",
  "flag",
  "kg",
  "lb",
  "lbs",
  "km",
  "gram",
  "tonne",
  "litre",
  "money",
  "thousand",
  "lakh",
  "crore",
  "million",
  "billion",
  "utc",
  "gmt",
  "ist",
  "sec",
  "min",
  "hr",
  "gb",
  "mb",
]);

/** True for GENERIC_TOKENS and bare numbers. */
const isGeneric = (t: string): boolean => GENERIC_TOKENS.has(t) || /^\d+$/.test(t);

/** True when every word of the phrase, stopwords aside, is generic ("name", "date", "total amount"). */
export function isGenericPhrase(phrase: string): boolean {
  return preparedPhrase(phrase).content.every(isGeneric);
}

/**
 * Tokens without stopwords, and without foreign ones between two words
 * (FOREIGN_STOPWORDS); all of them when nothing else is left ("to", "from"
 * as whole names).
 */
function content(tokens: readonly string[]): readonly string[] {
  const last = tokens.length - 1;
  const kept = tokens.filter((t, i) => !STOPWORDS.has(t) && !(i > 0 && i < last && FOREIGN_STOPWORDS.has(t)));
  return kept.length ? kept : [...tokens];
}

/**
 * Similarity between a column name and a synonym phrase, in [0, 1].
 * Exact token match > every synonym word present > one word spelt almost the
 * same way > partial overlap, which reaches detect/match.ts's MATCH_THRESHOLD
 * (0.55) only when the column is the synonym minus generic words.
 *
 * Scores, with stopwords ("of", "at") ignored from the containment step on:
 * 1 identical tokens; 0.97 identical once spaces are removed ("order id" vs
 * "orderid"); 0.95 the same words in another order or apart from stopwords
 * ("Date of Admission" vs "admission date", "Created" vs "created at"); 0.92
 * minus 0.07 per extra column word (floor 0.62) when
 * every synonym word is present, but only 0.6 when a one-word synonym meets a
 * column that adds a distinctive word, which usually names a different
 * concept ("Freight Cost" vs "cost", "Campaign status" vs "status",
 * "Customer Country" vs "customer"); 0.8 when the only difference is one word
 * spelt almost the same way ("fulfilment" vs "fulfillment": Jaro–Winkler ≥
 * 0.93, both at least 5 letters, so a shared prefix such as "customer" in
 * "Customer City" vs "customer type" is not enough); 0.6 when the column is
 * the synonym without some of its GENERIC_TOKENS ("Courier" vs "courier
 * name"); 0.35 when they share a non-generic word but otherwise differ, a
 * hint that only counts together with value evidence ("Market Rent" vs
 * "market value"); otherwise 0.
 */
export function nameSimilarity(columnTokens: readonly string[], synonym: string): number {
  const syn = preparedPhrase(synonym);
  if (syn.tokens.length === 0 || columnTokens.length === 0) return 0;
  const col = preparedTokens(columnTokens);
  if (col.joined === syn.joined) return 1;
  if (col.compact === syn.compact) return 0.97;
  const s = syn.content;
  const c = col.content;
  const synSet = syn.contentSet;
  const missing = s.filter((t) => !col.contentSet.has(t));
  const extra = c.filter((t) => !synSet.has(t));
  if (missing.length === 0) {
    if (extra.length === 0) return 0.95;
    // A one-word synonym only just clears the threshold against a column that adds a distinctive
    // word, so a synonym naming the whole phrase wins and the column counts as weak evidence.
    if (s.length === 1 && extra.some((t) => !isGeneric(t))) return 0.6;
    return Math.max(0.62, 0.92 - extra.length * 0.07);
  }
  if (missing.length === 1 && extra.length === 1) {
    const a = missing[0] as string;
    const b = extra[0] as string;
    if (Math.min(a.length, b.length) >= 5 && jaroWinkler(a, b) >= 0.93) return 0.8;
  }
  // Partial overlap: a shared distinctive word is a hint, not a match, because the words that differ
  // usually change the meaning ("injury claim" vs "claim paid"). Only a column that is the synonym
  // minus generic qualifiers ("Invoice" vs "invoice number") is close enough to count.
  if (!c.some((t) => synSet.has(t) && !isGeneric(t))) return 0;
  if (extra.length === 0 && missing.every(isGeneric)) return 0.6;
  return 0.35;
}

/** True when the name contains any of `tokens`, which must be in canonical form (see tokenize). */
export function hasToken(columnName: string, ...tokens: string[]): boolean {
  const t = new Set(tokenize(columnName));
  return tokens.some((x) => t.has(x));
}
