(function(global) {
    function MailFaker(locale) {
        this.locale = (typeof locale === 'string' && locales[locale]) ? locale : 'en';
        this.data = locales[this.locale];
    }

    MailFaker.version = '1.1.0';

    MailFaker.prototype._randomItem = function(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    };

    MailFaker.prototype.firstName = function(gender) {
        if (gender === 'female') return this._randomItem(this.data.firstNames.female);
        if (gender === 'male') return this._randomItem(this.data.firstNames.male);
        return this._randomItem(this._randomItem([this.data.firstNames.female, this.data.firstNames.male]));
    };

    MailFaker.prototype.lastName = function() {
        return this._randomItem(this.data.lastNames);
    };

    MailFaker.prototype.fullName = function(gender) {
        return this.firstName(gender) + ' ' + this.lastName();
    };

    MailFaker.prototype.localPart = function(gender) {
        var fn = this.firstName(gender).toLowerCase();
        var ln = this.lastName().toLowerCase();
        var sep = ['.', '-', '_'][Math.floor(Math.random() * 3)];
        var num = Math.floor(Math.random() * 9000 + 1000);

        var namePart = fn + sep + ln;
        var reverse = Math.random() < 0.5;

        return reverse ? num + sep + namePart : namePart + sep + num;
    };

    MailFaker.prototype.domainPart = function() {
        var domain = this._randomItem(this.data.domains);
        var tld = this._randomItem(globalTlds);
        return domain + '.' + tld;
    };

    MailFaker.prototype.fullAddress = function(gender) {
        return this.localPart(gender) + '@' + this.domainPart();
    };

    var locales = {
        en: {
            firstNames: {
                male: [
                    'John', 'Markus', 'Peter', 'David', 'Robert',
                    'James', 'William', 'Michael', 'Richard', 'Joseph',
                    'Charles', 'Thomas', 'Christopher', 'Daniel', 'Matthew',
                    'Anthony', 'Donald', 'Paul', 'George', 'Steven',
                    'Edward', 'Brian', 'Ronald', 'Kevin', 'Jason',
                    'Jeffrey', 'Ryan', 'Jacob', 'Gary', 'Nicholas',
                    'Eric', 'Stephen', 'Jonathan', 'Larry', 'Justin',
                    'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Frank',
                    'Gregory', 'Raymond', 'Alexander', 'Patrick', 'Jack',
                    'Dennis', 'Jerry', 'Tyler', 'Aaron', 'Adam'
                ],
                female: [
                    'Lisa', 'Manuela', 'Sabine', 'Anna', 'Julia',
                    'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth',
                    'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen',
                    'Nancy', 'Margaret', 'Lisa', 'Betty', 'Dorothy',
                    'Sandra', 'Ashley', 'Kimberly', 'Donna', 'Emily',
                    'Michelle', 'Carol', 'Amanda', 'Melissa', 'Deborah',
                    'Stephanie', 'Rebecca', 'Laura', 'Sharon', 'Cynthia',
                    'Kathleen', 'Amy', 'Shirley', 'Angela', 'Helen',
                    'Anna', 'Brenda', 'Pamela', 'Nicole', 'Emma',
                    'Samantha', 'Katherine', 'Christine', 'Debra', 'Rachel'
                ]
            },
            lastNames: [
                'Miller', 'Smith', 'Johnson', 'Williams', 'Brown',
                'Jones', 'Garcia', 'Davis', 'Rodriguez', 'Martinez',
                'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
                'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
                'Lee', 'Perez', 'Thompson', 'White', 'Harris',
                'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
                'Walker', 'Young', 'Allen', 'King', 'Wright',
                'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
                'Green', 'Adams', 'Nelson', 'Baker', 'Hall',
                'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
                'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz',
                'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes',
                'Stewart', 'Morris', 'Morales', 'Murphy', 'Cook',
                'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper',
                'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard',
                'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
                'Watson', 'Brooks', 'Chavez', 'Wood', 'James',
                'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes',
                'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel',
                'Myers', 'Long', 'Ross', 'Foster', 'Jimenez'
            ],
            domains: [
                'mailflare', 'netstream', 'inboxcore', 'postbridge', 'cloudsend',
                'fastmailer', 'msgnetic', 'mailhub', 'infonex', 'digitpost',
                'swiftconnect', 'netlance', 'mailbolt', 'zapmail', 'postgrid',
                'linkinbox', 'mailburst', 'datahatch', 'webpostix', 'mailflux',
                'postnova', 'sendloop', 'mailrange', 'cloudcrate', 'messario',
                'netpillar', 'postnest', 'skyinbox', 'streamsend', 'inboxwave',
                'dashmail', 'mailtide', 'zipconnect', 'airpostix', 'bytecourier',
                'netrelay', 'cloudflick', 'postnestor', 'senddome', 'mailium',
                'quanticmail', 'mailgator', 'fusepost', 'letterlab', 'coremail',
                'inboxport', 'vortexsend', 'msgcrate', 'maildrive', 'datapouch',
                'pingletter', 'maildock', 'postdrift', 'flashsender', 'postcore',
                'pushmailr', 'mailbitz', 'nexletter', 'inpostly', 'postlex',
                'netboxy', 'mailrise', 'delivernet', 'packetmail', 'airmailer',
                'sendpilgrim', 'poboxly', 'mailorama', 'webcourier', 'netmessenger',
                'flowmailr', 'jumpboxx', 'quikpost', 'mailtap', 'mailnutra',
                'boxpostr', 'mailcrate', 'inboxor', 'postflare', 'trumailr',
                'mailnova', 'messalink', 'sendgridz', 'rapidletter', 'inboxberry',
                'mailnest', 'zipmailer', 'trustinbox', 'cloudmailly', 'mailjump',
                'textorama', 'mailswirl', 'clickcourier', 'ultramailr', 'byteinbox',
                'packpost', 'mailbay', 'quicksendr', 'infopostix', 'netpigeon'
            ]
        },
        de: {
            firstNames: {
                male: [
                    'Benedikt', 'Lukas', 'Thomas', 'Andreas', 'Johannes',
                    'Felix', 'Paul', 'Leon', 'Maximilian', 'Julian',
                    'Moritz', 'Tim', 'Philipp', 'Daniel', 'Sebastian',
                    'Simon', 'David', 'Fabian', 'Tobias', 'Jan',
                    'Niklas', 'Noah', 'Matthias', 'Benjamin', 'Florian',
                    'Marcel', 'Erik', 'Nico', 'Jakob', 'Christian',
                    'Alexander', 'Oliver', 'Dominik', 'Patrick', 'Marco',
                    'Stefan', 'Kevin', 'Rafael', 'Jannis', 'Henrik',
                    'Michael', 'Elias', 'Emil', 'Karl', 'Till',
                    'Hannes', 'Luis', 'Jonas', 'Ruben', 'Malte'
                ],
                female: [
                    'Anabel', 'Nisa', 'Sabine', 'Gabi', 'Lisa',
                    'Julia', 'Anna', 'Lena', 'Laura', 'Marie',
                    'Sophie', 'Lea', 'Katharina', 'Sarah', 'Johanna',
                    'Clara', 'Nina', 'Mara', 'Alina', 'Franziska',
                    'Miriam', 'Eva', 'Antonia', 'Carolin', 'Melanie',
                    'Vanessa', 'Theresa', 'Luisa', 'Helena', 'Paula',
                    'Elena', 'Isabel', 'Charlotte', 'Annika', 'Linda',
                    'Jana', 'Selina', 'Tanja', 'Kristin', 'Ines',
                    'Monika', 'Martina', 'Stefanie', 'Angelina', 'Nadine',
                    'Rebecca', 'Verena', 'Sandra', 'Birgit', 'Amelie'
                ]
            },
            lastNames: [
                'Mueller', 'Meier', 'Schmidt', 'Schneider', 'Fischer',
                'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann',
                'Schulz', 'Koch', 'Bauer', 'Richter', 'Klein',
                'Wolf', 'Schroeder', 'Neumann', 'Schwarz', 'Zimmermann',
                'Braun', 'Krueger', 'Hofmann', 'Hartmann', 'Lange',
                'Schmitt', 'Werner', 'Krause', 'Zimmer', 'Walter',
                'Peters', 'Lang', 'Scholz', 'Mayer', 'Baumann',
                'Franke', 'Albrecht', 'Berger', 'Boehm', 'Kuehn',
                'Jung', 'Keller', 'Seidel', 'Graf', 'Winter',
                'Brandt', 'Heinrich', 'Hahn', 'Voigt', 'Busch',
                'Kuhn', 'Simon', 'Arnold', 'Lorenz', 'Otto',
                'Schreiber', 'Martin', 'Schulte', 'Reuter', 'Gross',
                'Dietrich', 'Ziegler', 'Friedrich', 'Schuster', 'Binder',
                'Kretschmer', 'Linke', 'Hauser', 'Horn', 'Barth',
                'Wendt', 'Engel', 'Eckert', 'Pfeiffer', 'Ludwig',
                'Bergmann', 'Voelker', 'Merkel', 'Rose', 'Weiss',
                'Mohr', 'Kaiser', 'Franz', 'Vogel', 'Adam',
                'Henkel', 'Stark', 'Bock', 'Koenig', 'Reinhardt',
                'Uhlig', 'Jakob', 'Heinz', 'Wolff', 'Roemer',
                'Tillmann', 'Gebhardt', 'Naumann', 'Urban', 'Geiger'
            ],
            domains: [
                'nachrichtenbox', 'webnachricht', 'maildienst', 'schnellmail', 'postinfo',
                'kontaktservice', 'mailportal', 'datenkurier', 'emailcenter', 'briefcloud',
                'netznachricht', 'inboxdienst', 'nachrichtwerk', 'kontaktnetz', 'webzustellung',
                'nachrichtlich', 'postversand', 'digitalpost', 'kontaktjetzt', 'schnellkontakt',
                'mailverbindung', 'webpostfach', 'mailklick', 'kontaktpost', 'datenpost',
                'nachrichtkompakt', 'postverbindung', 'infonachricht', 'kontaktmail', 'mailkontakt',
                'direktnachricht', 'sicheremail', 'kontaktbox', 'postzugang', 'nachrichtpunkt',
                'emailnetz', 'onlinemailbox', 'kontaktflink', 'digitalkontakt', 'kontaktjet',
                'einfachmail', 'servicekontakt', 'zustellnetz', 'webmailprofi', 'inboxplus',
                'nachrichtsmart', 'datennachricht', 'mailboten', 'kontaktmanager', 'zustelldienst',
                'postkontakt', 'emailpaket', 'mailablage', 'kontaktinsel', 'briefnetz',
                'smartkontakt', 'schnellversand', 'kontaktportal', 'netzbrief', 'emaildock',
                'zustellfix', 'kontaktaktiv', 'infonetzmail', 'mailconnect', 'kontaktone',
                'postkanal', 'mailflow', 'versandkontakt', 'inboxkraft', 'kontaktzone',
                'nachrichtsafe', 'emailunion', 'kontaktlink', 'postalpha', 'kontaktomat',
                'netzpostfach', 'briefconnect', 'sicherzustellung', 'emailpartner', 'kontaktcloud',
                'nachrichtplus', 'postbridge', 'mailpark', 'kontaktwerk', 'emailpilot',
                'infopostdienst', 'kontaktcenter', 'nachrichtmax', 'mailstation', 'kontaktunion',
                'briefservice', 'datenzusteller', 'netzmailbox', 'kontaktwerkstatt', 'poststart',
                'nachrichtportal', 'mailstation24', 'schnellzugang', 'kontaktbase', 'emailservicebox'
            ]
        },
        fr: {
            firstNames: {
                male: [
                    'Jean', 'Luc', 'Marc', 'Thierry', 'Pierre',
                    'Michel', 'Alain', 'Andre', 'Louis', 'Francois',
                    'Paul', 'Henri', 'Jacques', 'Claude', 'Gerard',
                    'Bernard', 'Pascal', 'Raymond', 'Christian', 'Didier',
                    'Antoine', 'Eric', 'Laurent', 'Julien', 'Nicolas',
                    'Maxime', 'Hugo', 'Sebastien', 'Olivier', 'Damien',
                    'Romain', 'Christophe', 'Florian', 'Philippe', 'Yann',
                    'Gabriel', 'Loic', 'Tristan', 'Arnaud', 'Mathieu',
                    'Benoit', 'Remi', 'Gael', 'Thibault', 'Alexandre',
                    'Quentin', 'Victor', 'Jules', 'Lucas', 'Cedric'
                ],
                female: [
                    'Marie', 'Nathalie', 'Chloe', 'Sophie', 'Claire',
                    'Isabelle', 'Catherine', 'Camille', 'Julie', 'Emilie',
                    'Helene', 'Anne', 'Valerie', 'Sandrine', 'Amandine',
                    'Christine', 'Elodie', 'Charlotte', 'Amelie', 'Lucie',
                    'Laetitia', 'Ines', 'Manon', 'Audrey', 'Noemie',
                    'Florence', 'Madeleine', 'Colette', 'Jacqueline', 'Aurelie',
                    'Veronique', 'Justine', 'Sarah', 'Delphine', 'Myriam',
                    'Lea', 'Adele', 'Clemence', 'Maelle', 'Alice',
                    'Jeanne', 'Mathilde', 'Cecile', 'Anais', 'Melanie',
                    'Caroline', 'Brigitte', 'Genevieve', 'Josephine', 'Eva'
                ]
            },
            lastNames: [
                'Dubois', 'Lefevre', 'Moreau', 'Laurent', 'Martin',
                'Bernard', 'Thomas', 'Petit', 'Robert', 'Richard',
                'Durand', 'Leroy', 'Roux', 'David', 'Bertrand',
                'Morel', 'Fournier', 'Girard', 'Bonnet', 'Dupont',
                'Lambert', 'Fontaine', 'Rousseau', 'Vincent', 'Muller',
                'Lemoine', 'Faure', 'Andre', 'Mercier', 'Blanc',
                'Guerin', 'Meyer', 'Marchand', 'Leclerc', 'Renaud',
                'Barbier', 'Perrin', 'Mathieu', 'Garnier', 'Chevalier',
                'Aubry', 'Renard', 'Charpentier', 'Roy', 'Clement',
                'Noel', 'Gauthier', 'Lopez', 'Baron', 'Mallet',
                'Brun', 'Henry', 'Chauvet', 'Pascal', 'Paris',
                'Jacob', 'Rolland', 'Adam', 'Benoit', 'Carre',
                'Delorme', 'Gilles', 'Perrot', 'Vallet', 'Lucas',
                'Collet', 'Bailly', 'Leger', 'Besson', 'Hardy',
                'Gilbert', 'Legrand', 'Masson', 'Navarro', 'Descamps',
                'Dumas', 'Pires', 'Rey', 'Verdier', 'Poirier',
                'Pichon', 'Raynaud', 'Cordier', 'Royer', 'Pelletier',
                'Blanchard', 'Lemoigne', 'Pasquier', 'Jacquet', 'Giraud',
                'Bourgeois', 'Morin', 'Chapel', 'Devaux', 'Thibault',
                'Hebert', 'Vasseur', 'Caron', 'Maillard', 'Picard'
            ],
            domains: [
                'mailvitesse', 'netcourri', 'postalis', 'francomail', 'courrivo',
                'telepost', 'mailoria', 'zonemail', 'courrielux', 'netpostal',
                'rapidemail', 'courrimail', 'frboxnet', 'numeriposte', 'eclairmail',
                'cibox', 'mailtic', 'courrieria', 'postanetix', 'messalia',
                'fournix', 'courriserve', 'infomess', 'lettromail', 'maileva',
                'cyberposte', 'messagor', 'serviposte', 'digitmail', 'courrios',
                'telecour', 'mailoque', 'courrisoft', 'mailique', 'frconnectix',
                'courrigo', 'mailvia', 'postyl', 'courrionet', 'rapidonet',
                'evomail', 'courriora', 'infrapost', 'proxinetmail', 'netmailis',
                'courrimax', 'linkoposte', 'messaflux', 'courrily', 'datamailix',
                'teleboxis', 'postanova', 'mailative', 'courricom', 'francoposte',
                'mailifique', 'courrinetix', 'fastcour', 'mailqube', 'postarena',
                'courrigen', 'mailvert', 'numerilink', 'postelio', 'mailcorex',
                'courrixis', 'velomail', 'quantiposte', 'courrisonic', 'weboposte',
                'mailnest', 'postably', 'courrizer', 'mailova', 'boximail',
                'postoria', 'courrialis', 'mailance', 'courringo', 'netomail',
                'mailnova', 'courrisoft', 'mailuno', 'posteoze', 'mailorion',
                'courriblue', 'veloposte', 'quickcourri', 'cybercour', 'courrino',
                'mailspace', 'courrovia', 'postelys', 'courrinet', 'mailtique',
                'courrizen', 'mailfluxis', 'servimail', 'courrident', 'datapostix'
            ]
        }
    };

    // Global TLDs (used across all locales)
    var globalTlds = ['com', 'net', 'org', 'info', 'biz', 'io', 'co', 'xyz', 'online', 'site'];

    // Export
    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = MailFaker;
    } else {
        global.MailFaker = MailFaker;
    }

})(this);
