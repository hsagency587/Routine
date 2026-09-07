# Storico

Qui vanno i file mensili dello storico, uno per mese: `storico-2026-09.md`,
`storico-2026-10.md` e cosi' via.

Non li scrive nessun automatismo. L'app tiene lo storico nel telefono e in
fondo alla pagina c'e' il menu dei mesi con il tasto **Scarica**: il file
finisce nei download del telefono, e da li' lo si porta in questa cartella
quando si vuole.

Ogni scarico rigenera il mese per intero dai dati che l'app ha in quel momento,
quindi riscaricare un mese gia' salvato e' sempre sicuro: il file nuovo
sostituisce il vecchio.

I file `storico-*.md` sono esclusi da git e dal deploy: contengono i commenti
delle giornate e non devono finire online. Se un giorno si vuole versionarli,
si toglie la riga da `.gitignore` e l'`--exclude='storico'` da
`.github/workflows/pages.yml`.
