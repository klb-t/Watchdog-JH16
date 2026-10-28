import json,sys,math
def pearson(x,y):
    n=len(x);mx=sum(x)/n;my=sum(y)/n
    sxy=sum((a-mx)*(b-my) for a,b in zip(x,y));sxx=sum((a-mx)**2 for a in x);syy=sum((b-my)**2 for b in y)
    return sxy/math.sqrt(sxx*syy)
def ranks(v):
    o=sorted(range(len(v)),key=lambda i:v[i]);r=[0]*len(v);i=0
    while i<len(o):
        j=i
        while j+1<len(o) and v[o[j+1]]==v[o[i]]: j+=1
        for k in range(i,j+1): r[o[k]]=(i+j)/2+1
        i=j+1
    return r
def spearman(x,y): return pearson(ranks(x),ranks(y))
def p_two_sided(r,n):
    t=r*math.sqrt((n-2)/(1-r*r)); df=n-2
    # regularized incomplete beta via continued fraction
    x=df/(df+t*t)
    def betacf(a,b,x):
        qab=a+b;qap=a+1;qam=a-1;c=1;d=1-qab*x/qap;d=1/d;h=d
        for m in range(1,300):
            m2=2*m;aa=m*(b-m)*x/((qam+m2)*(a+m2));d=1+aa*d;c=1+aa/c;d=1/d;h*=d*c
            aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2));d=1+aa*d;c=1+aa/c;d=1/d;de=d*c;h*=de
            if abs(de-1)<1e-15:break
        return h
    a=df/2;b=0.5
    bt=math.exp(math.lgamma(a+b)-math.lgamma(a)-math.lgamma(b)+a*math.log(x)+b*math.log(1-x))
    return bt*betacf(a,b,x)/a
