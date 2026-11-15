/**
 * @fileoverview Specifies `normalizeRecipient`: trim always, lower-case an email address,
 * leave any other identifier's case alone, independent of the process locale.
 * @layer domain
 */

import { normalizeRecipient } from './recipient'

describe('normalizeRecipient', () => {
  // The scope key must not depend on how a user typed the address: surrounding
  // whitespace and letter case describe the same mailbox for every mail provider
  // in practice, and two keys for one mailbox multiply the issue and attempt limits.
  it.each([
    ['Jane@Acme.com', 'jane@acme.com'],
    ['JANE@ACME.COM', 'jane@acme.com'],
    [' jane@acme.com', 'jane@acme.com'],
    ['jane@acme.com ', 'jane@acme.com'],
    ['\tJane@Acme.com\n', 'jane@acme.com'],
    ['jane@acme.com', 'jane@acme.com']
  ])('should fold the email %j to %j', (input, expected) => {
    expect(normalizeRecipient(input)).toBe(expected)
  })

  // A recipient that is not an email (a phone number, a device id) can be case
  // sensitive; only its surrounding whitespace is not part of the identifier.
  it.each([
    ['  +5511999990000 ', '+5511999990000'],
    ['Device-ABC', 'Device-ABC']
  ])('should only trim the non-email %j', (input, expected) => {
    expect(normalizeRecipient(input)).toBe(expected)
  })

  // Turkish dotted/dotless i must not make the fold depend on the process locale.
  it('should fold without consulting the locale', () => {
    expect(normalizeRecipient('I@Acme.com')).toBe('i@acme.com')
  })

  // The domain is compared by the resolver after IDNA/UTS #46 mapping, which folds compatibility
  // characters to the ASCII domain: spellings that differ only there are one domain, so one key.
  describe('the domain of an email', () => {
    it.each([
      ['jane@\uFF41\uFF43\uFF4D\uFF45.com', 'jane@acme.com'],
      ['Jane@\uFF21\uFF23\uFF2D\uFF25.COM', 'jane@acme.com'],
      ['jane@acme\uFF0Ecom', 'jane@acme.com'],
      ['jane@\uFB01rst.example', 'jane@first.example'],
      ['jane@\u2460.example', 'jane@1.example'],
      ['jane@acme.com', 'jane@acme.com']
    ])('should fold the compatibility characters of the domain in %j to %j', (input, expected) => {
      expect(normalizeRecipient(input)).toBe(expected)
    })

    // An internationalized domain has one spelling whichever way it is written: Unicode, upper case
    // or punycode.
    it.each([
      ['jane@b\u00FCcher.de', 'jane@xn--bcher-kva.de'],
      ['jane@B\u00DCCHER.DE', 'jane@xn--bcher-kva.de'],
      ['jane@xn--bcher-kva.de', 'jane@xn--bcher-kva.de'],
      ['jane@e\u0301.com', 'jane@xn--9ca.com'],
      ['jane@\u00E9.com', 'jane@xn--9ca.com'],
      ['jane@\u0915\u094D\u0937.com', 'jane@xn--11b2ezc.com']
    ])('should give the internationalized domain in %j one spelling, %j', (input, expected) => {
      expect(normalizeRecipient(input)).toBe(expected)
    })

    // The mapping is non-transitional, as the resolver's is: sharp s stays itself, so this domain
    // and the one spelled with ss are two domains.
    it('should keep a domain with a sharp s apart from the one spelled with ss', () => {
      expect(normalizeRecipient('jane@stra\u00DFe.de')).toBe('jane@xn--strae-oqa.de')
      expect(normalizeRecipient('jane@stra\u00DFe.de')).not.toBe(
        normalizeRecipient('jane@strasse.de')
      )
    })

    // A host whose last label is a number is read as an IPv4 address by the URL host parser, which
    // would give `0x7f.1` the spelling `127.0.0.1`. A top-level domain is never a number, so such a
    // host is not a domain name and stays as written (lower case).
    it.each([
      'jane@0x7f.1',
      'jane@127.1',
      'jane@1.2.3.4.5',
      'jane@0X7F.0.0.1',
      'jane@127.0.0.1.',
      'jane@127',
      'jane@0x7f',
      'jane@10.0xff',
      'jane@1.23'
    ])('should not read the numeric host in %j as an address', (input) => {
      expect(normalizeRecipient(input)).toBe(input.toLowerCase())
    })

    // An address literal is not a domain name. The IPv4 literal in brackets is rejected by the
    // mapping and keeps its own spelling, so it never shares a key with the bare address.
    it('should keep the bracketed IPv4 literal apart from the bare address', () => {
      expect(normalizeRecipient('user@[127.0.0.1]')).toBe('user@[127.0.0.1]')
      expect(normalizeRecipient('user@[127.0.0.1]')).not.toBe(normalizeRecipient('user@127.0.0.1'))
    })

    // An address literal is not a domain name: it keeps its own spelling, lower case, so the spellings of
    // one address stay apart and none is given the spelling of another host.
    it.each([
      ['user@[0:0:0:0:0:0:0:1]', 'user@[0:0:0:0:0:0:0:1]'],
      ['user@[::1]', 'user@[::1]'],
      ['user@[FE80::1]', 'user@[fe80::1]'],
      ['user@[2001:DB8:0:0:0:0:0:1]', 'user@[2001:db8:0:0:0:0:0:1]'],
      ['user@[IPv6:2001:DB8::1]', 'user@[ipv6:2001:db8::1]'],
      ['user@[IPv6:::1]', 'user@[ipv6:::1]']
    ])('should give the address literal in %j the spelling %j', (input, expected) => {
      expect(normalizeRecipient(input)).toBe(expected)
    })

    it('should keep an IPv6 literal apart from an IPv4 one', () => {
      expect(normalizeRecipient('user@[::ffff:127.0.0.1]')).not.toBe(
        normalizeRecipient('user@[127.0.0.1]')
      )
      expect(normalizeRecipient('user@[::ffff:127.0.0.1]')).not.toBe(
        normalizeRecipient('user@127.0.0.1')
      )
    })

    // Only the LAST label decides: a number elsewhere in a real domain does not stop the mapping.
    it('should map a domain that has a numeric label before its last one', () => {
      expect(normalizeRecipient('jane@123.b\u00FCcher.de')).toBe('jane@123.xn--bcher-kva.de')
      expect(normalizeRecipient('jane@a.123.b\u00FCcher.de')).toBe('jane@a.123.xn--bcher-kva.de')
    })

    // A domain the mapping rejects keeps its own spelling (compatibility-folded, lower case): it is
    // never given the spelling of another domain.
    it.each([
      ['jane@ex\u200Cample.com', 'jane@ex\u200Cample.com'],
      ['jane@a b.com', 'jane@a b.com'],
      // Plain domain text that breaks the bidirectional rule: the mapping returns nothing for it.
      ['jane@\u05D0A.COM', 'jane@\u05D0a.com'],
      ['jane@', 'jane@']
    ])('should keep the rejected domain in %j as written', (input, expected) => {
      expect(normalizeRecipient(input)).toBe(expected)
    })

    // Distinct domains never share a key, valid or not.
    it('should give every one of these distinct domains a key of its own', () => {
      const domains = [
        'acme.com',
        'acme.org',
        'acme.com.',
        'sub.acme.com',
        'b\u00FCcher.de',
        'stra\u00DFe.de',
        'strasse.de',
        '127.0.0.1',
        '0x7f.1',
        '[127.0.0.1]',
        '[::1]',
        '[IPv6:::1]',
        'ex\u200Cample.com',
        'example.com',
        'a b.com',
        'ab.com'
      ]

      const keys = domains.map((domain) => normalizeRecipient(`jane@${domain}`))

      expect(new Set(keys).size).toBe(domains.length)
    })

    // Everything before the last @ is the local part and is left as written, so a compatibility
    // character between two @ signs is not folded.
    it('should leave what precedes the last @ unfolded', () => {
      expect(normalizeRecipient('A@\uFB01@Acme.com')).toBe('a@\uFB01@acme.com')
    })

    // The mapping reads its input as the host of a URL, which has syntax: `#`, `/`, `?` and `\\` end
    // it, `%` is an escape, a tab or a newline is dropped. A domain with any of these must keep its
    // own spelling, or it shares the key of the domain it truncates to and a code mailed under one
    // verifies for the other.
    describe('a domain with URL syntax', () => {
      it.each([
        'victim.com#.evil.com',
        'victim.com/.evil.com',
        'victim.com?x.evil.com',
        'victim.com\\.evil.com',
        'victim.com:80',
        'victim.com%2eevil.com',
        '%76ictim.com',
        'victim%2ecom',
        'vic\ttim.com',
        'victim.com\n.evil.com',
        'victim.com\uFF03.evil.com',
        'victim.com\uFF0F.evil.com',
        'victim.com\uFF1F.evil.com',
        'victim.com\uFF05.evil.com',
        'victim.com\uFF1A80',
        'victim.com\u2100'
      ])('should keep the domain in %j apart from the one it would truncate to', (domain) => {
        const key = normalizeRecipient(`jane@${domain}`)

        expect(key).toBe(`jane@${domain.normalize('NFKC').toLowerCase()}`)
        expect(key).not.toBe(normalizeRecipient('jane@victim.com'))
        expect(key).not.toBe(normalizeRecipient('jane@evil.com'))
      })

      it.each(['0x7f.1#', '0x7f.1/x', '127.0.0.1#.evil.com', '127.0.0.1?'])(
        'should not read %j as the address it begins with',
        (domain) => {
          expect(normalizeRecipient(`jane@${domain}`)).not.toBe(
            normalizeRecipient('jane@127.0.0.1')
          )
        }
      )

      // A mark the mapping ignores hides the number from a test of the input, and the mapping then
      // returns the address. What decides is the host the mapping returns.
      it.each([
        '0x7f.1\uFE0F',
        '127.1\u180B',
        '1.23\u034F',
        '0x7f\uFE0F',
        '127.0.0.1\uFE0F',
        '10.0xff\u034F'
      ])(
        'should not read the host in %j as an address once the mapping drops its mark',
        (domain) => {
          const key = normalizeRecipient(`jane@${domain}`)

          expect(key).toBe(`jane@${domain.toLowerCase()}`)
          expect(key).not.toBe(normalizeRecipient('jane@127.0.0.1'))
        }
      )

      // The same marks in an ordinary name keep their own spelling too: the mapping drops them, which
      // is not a lower case or a punycode form of the label, so the domain is never given the spelling
      // of another one.
      it.each(['\uFE0F', '\u180B', '\u034F'])(
        'should keep the domain with the ignorable mark %j as written',
        (mark) => {
          expect(normalizeRecipient(`jane@a${mark}.com`)).toBe(`jane@a${mark}.com`)
          expect(normalizeRecipient(`jane@a${mark}.com`)).not.toBe(normalizeRecipient('jane@a.com'))
        }
      )

      // The class, not the list: whatever ASCII character is put into a domain, at either end or at any
      // place inside it, the key is neither the key of the domain without it nor the key of the part
      // before it, for a domain written in ASCII and for one written in Unicode.
      it('should never give a domain with an extra ASCII character the key of a shorter one', () => {
        const merged: string[] = []
        for (const base of ['victim.com', 'b\u00FCcher.de', 'b\u00FCcher', 'a.b\u00FCcher.de']) {
          const plain = normalizeRecipient(`jane@${base}`)
          for (let code = 0; code <= 0x7f; code += 1) {
            const character = String.fromCharCode(code)
            for (let at = 0; at <= base.length; at += 1) {
              // Surrounding whitespace is trimmed before any of this, by design.
              if (at === base.length && /\s/.test(character)) {
                continue
              }
              const domain = base.slice(0, at) + character + base.slice(at)
              const key = normalizeRecipient(`jane@${domain}`)
              const before = at === 0 ? '' : normalizeRecipient(`jane@${base.slice(0, at)}`)
              if (key === plain || key === before) {
                merged.push(JSON.stringify(domain))
              }
            }
          }
        }

        expect(merged).toEqual([])
      })

      // An escape at the start of a Unicode domain would be decoded into the spelling of another one.
      it.each(['%41b\u00FCcher.de', 'b\u00FCcher%41.de', 'b\u00FCcher.%64e', 'b\u00FC%63her.de'])(
        'should keep the escape in %j as written',
        (domain) => {
          expect(normalizeRecipient(`jane@${domain}`)).toBe(`jane@${domain.toLowerCase()}`)
        }
      )

      // What is left is letters, numbers, marks, hyphen, dot and underscore: the mapping still runs.
      it('should still map a domain made of plain domain characters', () => {
        expect(normalizeRecipient('jane@Sub_1.b\u00FCcher-x.de')).toBe(
          'jane@sub_1.xn--bcher-x-n2a.de'
        )
      })

      // A character that is not part of a name (a soft hyphen, a zero-width joiner) is not dropped
      // by the mapping: the domain keeps its own spelling, so it never shares a key with another.
      it.each(['a\u00AD.com', 'a\u200Db.com', 'a\u200Eb.com'])(
        'should keep the domain in %j as written',
        (domain) => {
          expect(normalizeRecipient(`jane@${domain}`)).toBe(`jane@${domain}`)
          expect(normalizeRecipient(`jane@${domain}`)).not.toBe(normalizeRecipient('jane@ab.com'))
        }
      )
    })

    // An address with more than one '@' is cut at the last one: what follows it is the domain.
    it('should treat what follows the last @ as the domain', () => {
      expect(normalizeRecipient('a@b@\uFF41\uFF43\uFF4D\uFF45.com')).toBe('a@b@acme.com')
    })
  })

  // A mailbox is named by its local part as written: two local parts that differ in a compatibility
  // character are two mailboxes at a provider that accepts them, and must not share one key, or a code
  // mailed to one would verify for the other.
  describe('the local part of an email', () => {
    it.each([
      ['\uFB01le@acme.com', '\uFB01le@acme.com'],
      ['user\u2460@acme.com', 'user\u2460@acme.com'],
      ['\u210C@acme.com', '\u210C@acme.com'],
      ['\uFF2A\uFF41\uFF4E\uFF45@acme.com', '\uFF4A\uFF41\uFF4E\uFF45@acme.com']
    ])(
      'should not fold the compatibility characters of the local part in %j',
      (input, expected) => {
        expect(normalizeRecipient(input)).toBe(expected)
      }
    )

    it('should keep a local part with a compatibility character apart from its plain spelling', () => {
      expect(normalizeRecipient('\uFB01le@acme.com')).not.toBe(normalizeRecipient('file@acme.com'))
    })

    it('should keep a plus tag, so a tagged address is a key of its own', () => {
      expect(normalizeRecipient('Jane+tag@Acme.com')).toBe('jane+tag@acme.com')
      expect(normalizeRecipient('jane+tag@acme.com')).not.toBe(normalizeRecipient('jane@acme.com'))
    })
  })

  // Only an ASCII @ makes an identifier an email: a fullwidth @ is not one, so its two sides are
  // never folded across a mailbox boundary.
  it('should only trim an identifier whose @ is a fullwidth one', () => {
    expect(normalizeRecipient('  Jane\uFF20\uFF21cme.com ')).toBe('Jane\uFF20\uFF21cme.com')
  })
})
