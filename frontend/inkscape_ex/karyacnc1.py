#!/usr/bin/env python
"""
Modified by Ryan widi saputra 2019-2020, reduce lots of code and leave important in the karyacnc javascript
Modified by Jay Johnson 2015, J Tech Photonics, Inc., jtechphotonics.com
modified by Adam Polak 2014, polakiumengineering.org

based on Copyright (C) 2009 Nick Drobchenko, nick@cnc-club.ru
based on gcode.py (C) 2007 hugomatic...
based on addnodes.py (C) 2005,2007 Aaron Spike, aaron@ekips.org
based on dots.py (C) 2005 Aaron Spike, aaron@ekips.org
based on interp.py (C) 2005 Aaron Spike, aaron@ekips.org
based on bezmisc.py (C) 2005 Aaron Spike, aaron@ekips.org
based on cubicsuperpath.py (C) 2005 Aaron Spike, aaron@ekips.org

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
"""

import inkex
from inkex.transforms import Transform
from inkex.paths import Path
import logging
import os
import tempfile
import socket
from lxml import etree

# Setup logging
log_dir = os.path.join(tempfile.gettempdir(), 'karyacnc_logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'karyacnc.log')
logging.basicConfig(filename=log_file, level=logging.DEBUG)
logger = logging.getLogger(__name__)


################################################################################
###
###        Styles and additional parameters
###
################################################################################

options = {}

xyscale=1



################################################################################
###        print_ prints any arguments into specified log file
################################################################################

def print_(*arg):
    f = open(options.log_filename,"a")
    for s in arg :
        s = str(unicode(s).encode('unicode_escape'))+" "
        f.write( s )
    f.write("\n")
    f.close()



################################################################################
###
###        Gcodetools class
###
################################################################################
class laser_gcode(inkex.Effect):
    def get_ip(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # doesn't even have to be reachable
            s.connect(('10.255.255.255', 1))
            IP = s.getsockname()[0]
        except Exception:
            IP = '127.0.0.1'
        finally:
            s.close()
        return IP

    def resolve_kip(self):
        kip = self.options.karyaws
        local_ip = self.get_ip().split('.')
        if not kip or kip[0] == ';':
            return "127.0.0.1"
        elif "." in kip:
            return kip
        else:
            # If only 1 digit/last number (or anything without dots)
            return f"{local_ip[0]}.{local_ip[1]}.{local_ip[2]}.{kip}"

    def export_path(self,paths,xmin,ymin):
        f=0
        if (self.options.directory!="") :
            f = open(self.options.directory+self.options.filename, "w")
        ss=f"X:{xyscale}\n"
        gcodes=[ss]
        if (f):f.write(ss)
        for pp in paths:
            style=pp[0]
            ss=f"P:{style['fill:']}:{style['stroke:']}:{style['stroke-width:']}\n"
            for p in pp[1]:
                ss+=f"{p[0]-xmin},{p[1]-ymin}\n"
            ss+="\n"
            if (f):f.write(ss)
            gcodes.append(ss)    
        if (xmin>9000):
            for i in self.images:
                xlink = i.get('xlink:href')
                if xlink.startswith('data:'):
                    xx=float(i.get("x"))
                    yy=float(i.get("y"))
        nn=0
        for i in self.images:
            xlink = i.get('xlink:href')
            if xlink.startswith('data:'):
                if (nn==0):
                  nn=1
                  ss=f"K,{xmin},{ymin}\n"
                  gcodes.append(ss)		
                  if (f):f.write(ss)
                data = xlink[5:]
                (mimetype, data) = data.split(';', 1)
                (base, data) = data.split(',', 1)
                trans = Transform()
                element = i.getparent()
                root = self.document.getroot()
                while element != root:
                    if 'transform' in element.attrib:
                        trans = Transform(element.get('transform')) @ trans
                    element = element.getparent()
                
                # Hitung posisi absolut
                point = (float(i.get("x", "0")), float(i.get("y", "0")))
                xx, yy = trans.apply_to_point(point)

                point2 = (float(i.get("width", "0"))+point[0],float(i.get("height", "0"))+point[1])
                xx2,yy2=trans.apply_to_point(point2)
                width=xx2-xx
                height=yy2-yy
                tt=i.get("transform","")
                ss = f"I,{xx},{yy},{width},{height},{tt}\n{data}\n"
                gcodes.append(ss)		
                if (f):f.write(ss)
        
        if (f):f.close()
        if True: # Always attempt to send if action is karyacnc
            from websocket import create_connection
            kip = self.resolve_kip()
            try:    
                ws = create_connection(f"ws://{kip}:{self.options.port}/",3000)
                for g in gcodes:
                    n = 15000
                    chunks = [g[i:i+n] for i in range(0, len(g), n)]
                    for c in chunks:
                        ws.send(c)
                ws.send(">REVECTOR2")
            except Exception as e:
                inkex.errormsg(f"Failed to connect to KaryaCNC: {str(e)}")
            finally:
                if 'ws' in locals():
                    ws.close() 
                    del ws       

    def __init__(self):
        inkex.Effect.__init__(self)
        self.karyacnc=""
        self.arg_parser.add_argument("--directory",type=str,default="",help="Output directory")
        self.arg_parser.add_argument("--filename",type=str,default="output.gcode",help="File name")
        self.arg_parser.add_argument("--karyaws",type=str,default=";",help="KaryaCNC WS Server IP last number")
        self.arg_parser.add_argument("--flatten",type=float,default="0.1",help="Flatten resolution")
        self.arg_parser.add_argument("--port",type=str,default="8887",help="Karyacnc port")
        # self.arg_parser.add_argument("--quiet_mode",type=str,default="false",help="Enable quiet mode (no success messages)")


    def get_transforms(self,g):
        root = self.document.getroot()
        trans = None
        while (g!=root):
            if 'transform' in g.keys():
                t = Transform(g.get('transform'))
                trans = (t@trans) if trans else t
            g=g.getparent()
        return trans


    def apply_transforms(self,g,csp):
        trans = self.get_transforms(g)
        return Path(csp).transform(trans).to_superpath() if trans else csp


    


################################################################################
###        Errors handling function, notes are just printed into Logfile,
###        warnings are printed into log file and warning message is displayed but
###        extension continues working, errors causes log and execution is halted
###        Notes, warnings adn errors could be assigned to space or comma or dot
###        sepparated strings (case is ignoreg).
################################################################################
    def error(self, s, type_= "Warning"):
        ## do nothing
        return



################################################################################
###
###        Get Gcodetools info from the svg
###
################################################################################
    def get_info(self):
        self.selected_paths = {}
        #self.paths = {}
        self.images= []
        self.orientation_points = {}
        self.layers = [self.document.getroot()]
        self.Zcoordinates = {}
        self.transform_matrix = {}
        self.transform_matrix_reverse = {}
        self.Zauto_scale = {}
        TAG1=inkex.addNS("g",'svg')
        TAG2=inkex.addNS('image','svg')
        TAG3=inkex.addNS('groupmode','inkscape')
        def recursive_search(g, layer, selected=False):
            if not(layer in self.selected_paths):
                self.selected_paths[layer]=[]
            for i in g.getchildren():
                itag=i.tag
                iid=i.get("id")
                iselected=selected
                if selected:
                    self.svg.selected[iid] = i
                else:
                    iselected=iid in self.svg.selected
                if itag == TAG1:
                    if i.get(TAG3) == 'layer':
                        self.layers.append(i)
                        recursive_search(i,i)
                    else:
                        recursive_search(i,layer, iselected )
                elif iselected :
                    if itag == TAG2:
                        self.images.append(i);
                    else:
                        self.selected_paths[layer].append(i)
        
        root=self.document.getroot()
        try:
          vb=root.get('viewBox').split(' ')
          vws=root.get('width')
          #vw=float(re.search("-?[0-9]*\.?\d+",vws)[0])
          #vh=float(root.get('height'))
          global xyscale
          xyscale=1.0#vw/(float(vb[2])-float(vb[0]))
          if (vws.find("pt")>0):xyscale=xyscale*127/360
        except:
          xyscale=1.0
          
        recursive_search(root,root)

    def laser(self) :
        gcode=""
        if (self.karyacnc):gcode = ";KARYACNC,"+self.karyacnc+"\n"
        
        getstyles=('fill:','stroke:','stroke-width:')
        attr_map={'fill':'fill:','stroke':'stroke:','stroke-width':'stroke-width:'}
        def parseStyle(node):
            res={}
            for attr,key in attr_map.items():
                v=node.get(attr)
                if v is not None:
                    res[key]=v
            if 'style' in node.attrib:
                style=node.get('style')
                if style!='':
                    styles=style.split(';')
                    for i in range(len(styles)):
                        for st in getstyles:
                            if styles[i].startswith(st):
                                res[st]=styles[i][len(st):]
            return res

        def getStyles(node):
            res={"fill:":"#ffffff","stroke:":"#000000","stroke-width:":"0","deep:":0,"repeat:":0}
            res['deep:']=node.get('deep')
            res['repeat:']=node.get('repeat')
            inherited = {}
            current = node
            root = self.document.getroot()
            while current is not None and current != root:
                parsed = parseStyle(current)
                for st in getstyles:
                    if st in parsed and st not in inherited:
                        inherited[st] = parsed[st]
                current = current.getparent()
            node_style = parseStyle(node)
            for st in getstyles:
                if st in node_style:
                    res[st] = node_style[st]
                elif st in inherited:
                    res[st] = inherited[st]
            return res

        
        if self.selected_paths == {} :
            paths=[]
            self.error(_("No paths are selected! Trying to work on all available paths."),"warning")
        else :
            paths = self.selected_paths
        from inkex.paths import CubicSuperPath
        kpaths = []
        xmin = 100000
        ymin = 100000

        for layer in [layer for layer in self.layers if layer in paths]:
            for path in paths[layer]:
                tag = path.tag.split('}')[-1] if '}' in path.tag else path.tag
                if tag in ('text', 'tspan'):
                    continue
                pstyle = getStyles(path)
                col = pstyle["fill:"]
                xpath = path.to_path_element()
                
                d = xpath.get('d')
                csp1 = CubicSuperPath(d)
                csp1 = self.apply_transforms(path, csp1)
                
                if any(char in d for char in ["A", "C", "Q", "a", "c", "q"]):
                    inkex.bezier.cspsubdiv(csp1, self.options.flatten * 0.2)
                
                for sp in csp1:
                    first = True
                    num=len(sp)
                    #gcode+=";"+str(cw)+"\n"
                    sum=0
                    ln=0
                    kpath=[]
                    for icsp in range(num):
                        csp=sp[icsp]
                        kpath.append((csp[1][0],csp[1][1]))
                        xmin=min(xmin,csp[1][0])
                        ymin=min(ymin,csp[1][1])
                        
                    kpaths.append((dict(pstyle), kpath))

        self.export_path(kpaths, xmin, ymin)


################################################################################
###
###        Effect
###
###        Main function of Gcodetools class
###
################################################################################
    def effect(self) :
        self.get_info()
        # Kumpulkan objek terpilih non-teks (teks/tspan = anotasi, dilewati)
        other_objects = {}
        for layer in self.selected_paths:
            for elem in self.selected_paths[layer]:
                tag = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                if tag in ('text', 'tspan'):
                    continue
                other_objects.setdefault(layer, []).append(elem)

        if other_objects:
            self.laser()
        else:
            inkex.errormsg("Tidak ada seleksi. Pilih objek untuk G-code.")


if __name__ == '__main__':
    laser_gcode().run()
